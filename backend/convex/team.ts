import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireClientRole } from "./lib/rbac";
import type { ClientRole } from "./lib/rbac";
import { actorTypeForClientRole, recordAudit } from "./auditLog";
import { displayName } from "./reviewQueue";
import { CLIENT_ROLES, QUEUES, REVIEW_WORK_ROLES, emailAllowed, loadClientSettings } from "./lib/clientSettings";

// Team management for a client's own Admin (Settings → Team): invite
// members, change roles, choose their review queues, deactivate, reactivate
// and remove them, within the seat limit DeepTrack sets (clients.seatLimit).
// Invitees become members the first time they sign in with the invited,
// verified email (acceptMyInvites). The invitation email itself is sent by
// the portal's server action through Auth0 (settings/team/actions.ts).

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_MEMBERS = 500;
const MAX_INVITES = 200;
const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const roleValidator = v.union(...CLIENT_ROLES.map((role) => v.literal(role)));

function invalid(message: string): never {
  throw new ConvexError({ code: "invalid_argument", message });
}

export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) invalid("Enter a valid email address.");
  return email;
}

async function members(ctx: Pick<QueryCtx, "db">, clientId: Id<"clients">) {
  return await ctx.db
    .query("clientMembers")
    .withIndex("by_client", (q) => q.eq("clientId", clientId))
    .take(MAX_MEMBERS);
}

async function pendingInvites(ctx: Pick<QueryCtx, "db">, clientId: Id<"clients">, now: number) {
  const rows = await ctx.db
    .query("teamInvites")
    .withIndex("by_client_and_status", (q) => q.eq("clientId", clientId).eq("status", "pending"))
    .take(MAX_INVITES);
  return rows.filter((row) => row.expiresAt > now);
}

// Seats in use: active members plus unexpired pending invites.
export async function seatUsage(ctx: Pick<QueryCtx, "db">, clientId: Id<"clients">, now = Date.now()) {
  const [rows, invites, client] = await Promise.all([members(ctx, clientId), pendingInvites(ctx, clientId, now), ctx.db.get(clientId)]);
  const active = rows.filter((row) => row.isActive).length;
  return { used: active + invites.length, active, pending: invites.length, limit: client?.seatLimit ?? null };
}

async function assertSeatAvailable(ctx: Pick<QueryCtx, "db">, clientId: Id<"clients">) {
  const seats = await seatUsage(ctx, clientId);
  if (seats.limit !== null && seats.used >= seats.limit) {
    throw new ConvexError({
      code: "seat_limit",
      message: `All ${seats.limit} seats on your plan are in use. Deactivate a member or ask DeepTrack for more seats.`,
    });
  }
}

async function profilesFor(ctx: Pick<QueryCtx, "db">, userIds: string[]) {
  const rows = await Promise.all(
    userIds.map((userId) => ctx.db.query("userProfiles").withIndex("by_user_id", (q) => q.eq("userId", userId)).unique()),
  );
  return new Map(rows.filter((row): row is Doc<"userProfiles"> => row !== null).map((row) => [row.userId, row]));
}

async function requireAdmin(ctx: MutationCtx | QueryCtx, clientId: Id<"clients">) {
  return await requireClientRole(ctx, clientId, ["client_admin"]);
}

async function actorName(ctx: { auth: QueryCtx["auth"] }) {
  return displayName(await ctx.auth.getUserIdentity());
}

// ── Queries ─────────────────────────────────────────────────────────────────

export const overview = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.clientId);
    const now = Date.now();
    const [rows, invites, seats, settings, resolved] = await Promise.all([
      members(ctx, args.clientId),
      pendingInvites(ctx, args.clientId, now),
      seatUsage(ctx, args.clientId, now),
      loadClientSettings(ctx, args.clientId),
      ctx.db
        .query("reviewQueue")
        .withIndex("by_client_and_status", (q) => q.eq("clientId", args.clientId).eq("status", "resolved"))
        .order("desc")
        .take(1000),
    ]);
    const profiles = await profilesFor(ctx, rows.map((row) => row.userId));
    const handled = new Map<string, number>();
    for (const row of resolved) {
      for (const userId of new Set([row.resolvedBy, row.approvedBy, row.recommendation?.by].filter(Boolean) as string[])) {
        handled.set(userId, (handled.get(userId) ?? 0) + 1);
      }
    }
    return {
      currentUserId: actor.userId,
      seats,
      allowedEmailDomains: settings.security.allowedEmailDomains,
      members: rows
        .map((row) => {
          const profile = profiles.get(row.userId);
          return {
            _id: row._id,
            userId: row.userId,
            name: profile?.name ?? null,
            email: profile?.email ?? null,
            role: row.role,
            isActive: row.isActive,
            queues: row.queues ?? [],
            createdAt: row.createdAt > 0 ? row.createdAt : Math.floor(row._creationTime),
            lastSeenAt: profile?.lastSeenAt ?? null,
            deactivatedAt: row.deactivatedAt ?? null,
            casesHandled: handled.get(row.userId) ?? 0,
            outsideAllowedDomains: Boolean(profile?.email) && !emailAllowed(profile!.email!, settings.security.allowedEmailDomains),
          };
        })
        .sort((a, b) => Number(b.isActive) - Number(a.isActive) || (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "")),
      invites: invites
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((row) => ({
          _id: row._id,
          email: row.email,
          role: row.role,
          invitedByName: row.invitedByName ?? null,
          emailStatus: row.emailStatus ?? null,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
        })),
    };
  },
});

// Members a case can be assigned to: active admins, reviewers and analysts.
// Visible to everyone who works the review queue.
export const assignableMembers = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, REVIEW_WORK_ROLES);
    const rows = (await members(ctx, args.clientId)).filter((row) => row.isActive && REVIEW_WORK_ROLES.includes(row.role));
    const profiles = await profilesFor(ctx, rows.map((row) => row.userId));
    return rows.map((row) => ({
      userId: row.userId,
      name: profiles.get(row.userId)?.name ?? profiles.get(row.userId)?.email ?? "Team member",
      role: row.role,
    }));
  },
});

// ── Invitations ─────────────────────────────────────────────────────────────

// Creates (or renews) a pending invite. Returns what the server action needs
// to send the Auth0 invitation email.
export const createInvite = mutation({
  args: { clientId: v.id("clients"), email: v.string(), role: roleValidator },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.clientId);
    const email = normalizeEmail(args.email);
    const settings = await loadClientSettings(ctx, args.clientId);
    if (!emailAllowed(email, settings.security.allowedEmailDomains)) {
      invalid(`Only ${settings.security.allowedEmailDomains.map((domain) => `@${domain}`).join(", ")} addresses can be invited (Settings → Security).`);
    }
    const now = Date.now();

    // Already a member?
    const rows = await members(ctx, args.clientId);
    const profiles = await profilesFor(ctx, rows.map((row) => row.userId));
    const existing = rows.find((row) => profiles.get(row.userId)?.email?.toLowerCase() === email);
    if (existing?.isActive) invalid(`${email} is already a member of your team.`);
    if (existing) invalid(`${email} is a deactivated member. Reactivate them instead of inviting again.`);

    const invites = await pendingInvites(ctx, args.clientId, now);
    const current = invites.find((row) => row.email === email);
    const invitedByName = await actorName(ctx);
    if (current) {
      // Renew: new role and expiry, and the email is sent again.
      await ctx.db.patch(current._id, { role: args.role, expiresAt: now + INVITE_TTL_MS, invitedBy: actor.userId, invitedByName, emailStatus: undefined });
      await recordAudit(ctx, {
        actorId: actor.userId,
        actorType: actorTypeForClientRole(actor.role),
        action: "team.invite_renewed",
        targetType: "teamInvite",
        targetId: current._id,
        clientId: args.clientId,
        metadata: { email, role: args.role, previousRole: current.role },
      });
      return { inviteId: current._id, email, role: args.role, renewed: true, previousAuth0InvitationId: current.auth0InvitationId ?? null };
    }

    await assertSeatAvailable(ctx, args.clientId);
    const inviteId = await ctx.db.insert("teamInvites", {
      clientId: args.clientId,
      email,
      role: args.role,
      status: "pending",
      invitedBy: actor.userId,
      invitedByName,
      createdAt: now,
      expiresAt: now + INVITE_TTL_MS,
    });
    await recordAudit(ctx, {
      actorId: actor.userId,
      actorType: actorTypeForClientRole(actor.role),
      action: "team.invite_created",
      targetType: "teamInvite",
      targetId: inviteId,
      clientId: args.clientId,
      metadata: { email, role: args.role },
    });
    return { inviteId, email, role: args.role, renewed: false, previousAuth0InvitationId: null };
  },
});

// Records whether the invitation email went out (called by the server
// action after the Auth0 request).
export const recordInviteEmail = mutation({
  args: { inviteId: v.id("teamInvites"), sent: v.boolean(), auth0InvitationId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId);
    if (!invite) throw new ConvexError({ code: "not_found", message: "Invitation not found." });
    await requireAdmin(ctx, invite.clientId);
    await ctx.db.patch(invite._id, {
      emailStatus: args.sent ? "sent" : "failed",
      ...(args.auth0InvitationId ? { auth0InvitationId: args.auth0InvitationId.slice(0, 100) } : {}),
    });
    return null;
  },
});

export const revokeInvite = mutation({
  args: { inviteId: v.id("teamInvites") },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId);
    if (!invite) throw new ConvexError({ code: "not_found", message: "Invitation not found." });
    const actor = await requireAdmin(ctx, invite.clientId);
    if (invite.status !== "pending") invalid("This invitation is no longer pending.");
    await ctx.db.patch(invite._id, { status: "revoked", revokedAt: Date.now(), revokedBy: actor.userId });
    await recordAudit(ctx, {
      actorId: actor.userId,
      actorType: actorTypeForClientRole(actor.role),
      action: "team.invite_revoked",
      targetType: "teamInvite",
      targetId: invite._id,
      clientId: invite.clientId,
      metadata: { email: invite.email, role: invite.role },
    });
    return { auth0InvitationId: invite.auth0InvitationId ?? null };
  },
});

// Turns the signed-in user's pending invites into memberships. Only a
// verified email counts: otherwise anyone could sign up with an invitee's
// address and join their team. Called on sign-in (platform layout and the
// Convex provider); a no-op when there is nothing pending.
export const acceptMyInvites = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || identity.emailVerified !== true || typeof identity.email !== "string") return { accepted: 0 };
    const email = identity.email.trim().toLowerCase();
    const now = Date.now();
    const invites = (
      await ctx.db
        .query("teamInvites")
        .withIndex("by_email_and_status", (q) => q.eq("email", email).eq("status", "pending"))
        .take(20)
    ).filter((invite) => invite.expiresAt > now);
    let accepted = 0;
    for (const invite of invites) {
      const client = await ctx.db.get(invite.clientId);
      if (!client || client.status !== "active") continue;
      const settings = await loadClientSettings(ctx, invite.clientId);
      if (!emailAllowed(email, settings.security.allowedEmailDomains)) continue;
      const existing = await ctx.db
        .query("clientMembers")
        .withIndex("by_client_and_user", (q) => q.eq("clientId", invite.clientId).eq("userId", identity.subject))
        .unique();
      let membershipId: Id<"clientMembers">;
      if (existing) {
        membershipId = existing._id;
        await ctx.db.patch(existing._id, { role: invite.role, isActive: true, invitedBy: invite.invitedBy, deactivatedAt: undefined, deactivatedBy: undefined });
      } else {
        membershipId = await ctx.db.insert("clientMembers", {
          clientId: invite.clientId,
          userId: identity.subject,
          role: invite.role,
          isActive: true,
          invitedBy: invite.invitedBy,
          createdAt: now,
        });
      }
      await ctx.db.patch(invite._id, { status: "accepted", acceptedAt: now, acceptedBy: identity.subject });
      await recordAudit(ctx, {
        actorId: identity.subject,
        actorType: "client_user",
        action: "team.invite_accepted",
        targetType: "user",
        targetId: identity.subject,
        clientId: invite.clientId,
        metadata: { inviteId: invite._id, membershipId, email, role: invite.role },
      });
      accepted += 1;
    }
    return { accepted };
  },
});

// ── Members ─────────────────────────────────────────────────────────────────

async function loadMember(ctx: MutationCtx, membershipId: Id<"clientMembers">) {
  const member = await ctx.db.get(membershipId);
  if (!member) throw new ConvexError({ code: "not_found", message: "Team member not found." });
  const actor = await requireAdmin(ctx, member.clientId);
  return { member, actor };
}

// A team always keeps at least one active Admin.
async function assertNotLastAdmin(ctx: MutationCtx, member: Doc<"clientMembers">) {
  if (member.role !== "client_admin" || !member.isActive) return;
  const admins = (await members(ctx, member.clientId)).filter((row) => row.isActive && row.role === "client_admin");
  if (admins.length <= 1) invalid("Your team needs at least one active Admin. Make someone else an Admin first.");
}

async function auditMember(
  ctx: MutationCtx,
  actor: { userId: string; role: ClientRole | "internal_admin" },
  member: Doc<"clientMembers">,
  action: string,
  metadata: Record<string, unknown>,
) {
  await recordAudit(ctx, {
    actorId: actor.userId,
    actorType: actorTypeForClientRole(actor.role),
    action,
    targetType: "user",
    targetId: member.userId,
    clientId: member.clientId,
    metadata: { membershipId: member._id, ...metadata },
  });
}

export const changeRole = mutation({
  args: { membershipId: v.id("clientMembers"), role: roleValidator },
  handler: async (ctx, args) => {
    const { member, actor } = await loadMember(ctx, args.membershipId);
    if (member.role === args.role) return null;
    if (args.role !== "client_admin") await assertNotLastAdmin(ctx, member);
    await ctx.db.patch(member._id, { role: args.role });
    await auditMember(ctx, actor, member, "team.role_changed", { before: member.role, after: args.role });
    return null;
  },
});

export const setQueues = mutation({
  args: { membershipId: v.id("clientMembers"), queues: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { member, actor } = await loadMember(ctx, args.membershipId);
    const queues = [...new Set(args.queues)];
    const unknown = queues.filter((queue) => !(QUEUES as readonly string[]).includes(queue));
    if (unknown.length) invalid(`Unknown queues: ${unknown.join(", ")}.`);
    await ctx.db.patch(member._id, { queues });
    await auditMember(ctx, actor, member, "team.queues_changed", { before: member.queues ?? [], after: queues });
    return null;
  },
});

export const deactivate = mutation({
  args: { membershipId: v.id("clientMembers") },
  handler: async (ctx, args) => {
    const { member, actor } = await loadMember(ctx, args.membershipId);
    if (!member.isActive) return null;
    if (member.userId === actor.userId) invalid("You can't deactivate yourself. Ask another Admin.");
    await assertNotLastAdmin(ctx, member);
    const now = Date.now();
    await ctx.db.patch(member._id, { isActive: false, deactivatedAt: now, deactivatedBy: actor.userId });
    // Their open cases go back to the unassigned queue.
    const open = await ctx.db
      .query("reviewQueue")
      .withIndex("by_client_and_status", (q) => q.eq("clientId", member.clientId).eq("status", "pending"))
      .take(1000);
    const inReview = await ctx.db
      .query("reviewQueue")
      .withIndex("by_client_and_status", (q) => q.eq("clientId", member.clientId).eq("status", "in_review"))
      .take(1000);
    let released = 0;
    for (const row of [...open, ...inReview]) {
      if (row.clientAssignedTo !== member.userId) continue;
      await ctx.db.patch(row._id, { clientAssignedTo: undefined, clientAssignedToName: undefined, clientAssignedAt: undefined });
      released += 1;
    }
    await auditMember(ctx, actor, member, "team.member_deactivated", { role: member.role, casesReleased: released });
    return { casesReleased: released };
  },
});

export const reactivate = mutation({
  args: { membershipId: v.id("clientMembers") },
  handler: async (ctx, args) => {
    const { member, actor } = await loadMember(ctx, args.membershipId);
    if (member.isActive) return null;
    await assertSeatAvailable(ctx, member.clientId);
    await ctx.db.patch(member._id, { isActive: true, deactivatedAt: undefined, deactivatedBy: undefined });
    await auditMember(ctx, actor, member, "team.member_reactivated", { role: member.role });
    return null;
  },
});

// Removes a deactivated member from the list. Their history (audit log,
// decisions on cases) is kept.
export const remove = mutation({
  args: { membershipId: v.id("clientMembers") },
  handler: async (ctx, args) => {
    const { member, actor } = await loadMember(ctx, args.membershipId);
    if (member.isActive) invalid("Deactivate the member before removing them.");
    await ctx.db.delete(member._id);
    await auditMember(ctx, actor, member, "team.member_removed", { role: member.role });
    return null;
  },
});
