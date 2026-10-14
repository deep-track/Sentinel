import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { isInternalAdmin, requireClientRole } from "./lib/rbac";
import { actorTypeForClientRole, recordAudit } from "./auditLog";
import { RISK_TYPES, RISK_TYPE_LABELS } from "./lib/adverseMedia";
import { POA_DOCUMENT_TYPES } from "./lib/documentChecks";
import {
  CASE_CATEGORIES,
  CASE_CATEGORY_LABELS,
  CLIENT_ROLES,
  DECISION_ROLES,
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_LABELS,
  PERSONAL_EVENTS,
  QUEUES,
  QUEUE_LABELS,
  REGULATORS,
  REGULATOR_LABELS,
  ROLE_LABELS,
  MAX_MATCH_THRESHOLD,
  MAX_POA_AGE_DAYS,
  MAX_RETENTION_MONTHS,
  MIN_MATCH_THRESHOLD,
  MIN_RETENTION_MONTHS,
  dataSettingsValidator,
  ipAllowed,
  loadClientSettings,
  lowCreditLevel,
  notificationSettingsValidator,
  profileSettingsValidator,
  reviewSettingsValidator,
  screeningSettingsValidator,
  securitySettingsValidator,
  validateDataSettings,
  validateNotificationSettings,
  validateProfileSettings,
  validateReviewSettings,
  validateScreeningSettings,
  validateSecuritySettings,
} from "./lib/clientSettings";

// Settings → each section of a client's own settings (lib/clientSettings.ts).
// Every member can read them (analysts need the review reasons, the AML
// report needs the profile); only the client's Admin saves them, and each
// save is audited with the before and after values.

const ALL_ROLES = [...CLIENT_ROLES];
const MAX_LOGO_BYTES = 1024 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];

type Section = "review" | "screening" | "notifications" | "security" | "data" | "profile";

function invalid(message: string): never {
  throw new ConvexError({ code: "invalid_argument", message });
}

async function saveSection(ctx: MutationCtx, clientId: Id<"clients">, section: Section, value: unknown) {
  const actor = await requireClientRole(ctx, clientId, ["client_admin"]);
  const row = await ctx.db
    .query("clientSettings")
    .withIndex("by_client", (q) => q.eq("clientId", clientId))
    .unique();
  const now = Date.now();
  const before = row?.[section] ?? null;
  if (row) {
    await ctx.db.patch(row._id, { [section]: value, updatedAt: now, updatedBy: actor.userId });
  } else {
    await ctx.db.insert("clientSettings", { clientId, [section]: value, updatedAt: now, updatedBy: actor.userId });
  }
  await recordAudit(ctx, {
    actorId: actor.userId,
    actorType: actorTypeForClientRole(actor.role),
    action: `settings.${section}_updated`,
    targetType: "clientSettings",
    targetId: clientId,
    clientId,
    metadata: { before, after: value },
  });
  return actor;
}

export const get = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const actor = await requireClientRole(ctx, args.clientId, ALL_ROLES);
    const [client, settings] = await Promise.all([ctx.db.get(args.clientId), loadClientSettings(ctx, args.clientId)]);
    if (!client) return null;
    const logoUrl = settings.profile.logoStorageId ? await ctx.storage.getUrl(settings.profile.logoStorageId) : null;
    return {
      role: actor.role,
      canEdit: actor.role === "client_admin" || actor.role === "internal_admin",
      client: {
        name: client.name,
        plan: client.plan,
        status: client.status,
        seatLimit: client.seatLimit ?? null,
        lowCreditDefault: lowCreditLevel(client, { ...settings.notifications, lowCreditBalance: null }),
        creditBalance: client.creditBalance ?? null,
      },
      settings,
      logoUrl,
      options: {
        roles: CLIENT_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] })),
        decisionRoles: DECISION_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] })),
        categories: CASE_CATEGORIES.map((category) => ({ value: category, label: CASE_CATEGORY_LABELS[category] })),
        queues: QUEUES.map((queue) => ({ value: queue, label: QUEUE_LABELS[queue] })),
        adverseMedia: RISK_TYPES.map((type) => ({ value: type, label: RISK_TYPE_LABELS[type] })),
        poaDocuments: POA_DOCUMENT_TYPES.filter((type) => type !== "other").map((type) => ({
          value: type,
          label: type.replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase()),
        })),
        events: NOTIFICATION_EVENTS.map((event) => ({ value: event, ...NOTIFICATION_EVENT_LABELS[event], personal: PERSONAL_EVENTS.includes(event) })),
        regulators: REGULATORS.map((regulator) => ({ value: regulator, label: REGULATOR_LABELS[regulator] })),
        limits: {
          minMatchThreshold: MIN_MATCH_THRESHOLD,
          maxMatchThreshold: MAX_MATCH_THRESHOLD,
          maxPoaAgeDays: MAX_POA_AGE_DAYS,
          minRetentionMonths: MIN_RETENTION_MONTHS,
          maxRetentionMonths: MAX_RETENTION_MONTHS,
        },
      },
    };
  },
});

export const saveReview = mutation({
  args: { clientId: v.id("clients"), review: reviewSettingsValidator },
  handler: async (ctx, args) => {
    await saveSection(ctx, args.clientId, "review", validateReviewSettings(args.review));
    return null;
  },
});

export const saveScreening = mutation({
  args: { clientId: v.id("clients"), screening: screeningSettingsValidator },
  handler: async (ctx, args) => {
    const screening = validateScreeningSettings(args.screening, { adverseMedia: RISK_TYPES, poaDocuments: POA_DOCUMENT_TYPES });
    await saveSection(ctx, args.clientId, "screening", screening);
    return null;
  },
});

export const saveNotifications = mutation({
  args: { clientId: v.id("clients"), notifications: notificationSettingsValidator },
  handler: async (ctx, args) => {
    await saveSection(ctx, args.clientId, "notifications", validateNotificationSettings(args.notifications));
    return null;
  },
});

// `currentIp` is the address the Admin is saving from (read by the page on
// the server). An allowlist that would lock them out is refused.
export const saveSecurity = mutation({
  args: { clientId: v.id("clients"), security: securitySettingsValidator, currentIp: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const security = validateSecuritySettings(args.security);
    const rules = security.ipAllowlist ?? [];
    if (rules.length > 0 && !(await isInternalAdmin(ctx)) && !ipAllowed(args.currentIp, rules)) {
      invalid(`Your current address (${args.currentIp ?? "unknown"}) isn't in the allowlist, so saving it would lock you out. Add it first.`);
    }
    await saveSection(ctx, args.clientId, "security", security);
    return null;
  },
});

export const saveData = mutation({
  args: { clientId: v.id("clients"), data: dataSettingsValidator },
  handler: async (ctx, args) => {
    await saveSection(ctx, args.clientId, "data", validateDataSettings(args.data));
    return null;
  },
});

export const saveProfile = mutation({
  args: { clientId: v.id("clients"), profile: profileSettingsValidator },
  handler: async (ctx, args) => {
    // The logo is changed with setLogo only.
    const settings = await loadClientSettings(ctx, args.clientId);
    const { logoStorageId: _ignored, ...rest } = args.profile;
    const profile = validateProfileSettings(rest);
    await saveSection(ctx, args.clientId, "profile", { ...profile, ...(settings.profile.logoStorageId ? { logoStorageId: settings.profile.logoStorageId } : {}) });
    return null;
  },
});

export const generateLogoUploadUrl = mutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin"]);
    return await ctx.storage.generateUploadUrl();
  },
});

// Sets (or with no storageId, removes) the logo shown on reports. The old
// file is deleted from storage.
export const setLogo = mutation({
  args: { clientId: v.id("clients"), storageId: v.optional(v.id("_storage")) },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin"]);
    if (args.storageId) {
      const file = await ctx.db.system.get(args.storageId);
      if (!file) invalid("The upload wasn't found. Try again.");
      if (!LOGO_TYPES.includes(file.contentType ?? "") || file.size > MAX_LOGO_BYTES) {
        await ctx.storage.delete(args.storageId);
        invalid("The logo must be a PNG, JPEG or WebP image of at most 1 MB.");
      }
    }
    const settings = await loadClientSettings(ctx, args.clientId);
    const previous = settings.profile.logoStorageId;
    const { logoStorageId: _old, ...rest } = settings.profile;
    await saveSection(ctx, args.clientId, "profile", args.storageId ? { ...rest, logoStorageId: args.storageId } : rest);
    if (previous && previous !== args.storageId) await ctx.storage.delete(previous);
    return null;
  },
});

// What the platform layout enforces for the signed-in member of this
// client: MFA, the idle timeout and the IP allowlist. DeepTrack staff
// (internal admins) are governed by DeepTrack's own policy, not a client's.
export const gate = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ALL_ROLES);
    if (await isInternalAdmin(ctx)) return { requireMfa: false, sessionTimeoutMinutes: 0, ipAllowlist: [] as string[] };
    const { security } = await loadClientSettings(ctx, args.clientId);
    return { requireMfa: security.requireMfa, sessionTimeoutMinutes: security.sessionTimeoutMinutes, ipAllowlist: security.ipAllowlist };
  },
});

// How many checks are older than the retention period. Records are not
// deleted automatically: removal needs the compliance officer's sign-off.
export const retentionReport = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin"]);
    const { data } = await loadClientSettings(ctx, args.clientId);
    const cutoff = new Date();
    cutoff.setUTCMonth(cutoff.getUTCMonth() - data.retentionMonths);
    const rows = await ctx.db
      .query("verifications")
      .withIndex("by_client_and_created_at", (q) => q.eq("clientId", args.clientId).lt("createdAt", cutoff.getTime()))
      .take(1001);
    const oldest = await ctx.db
      .query("verifications")
      .withIndex("by_client_and_created_at", (q) => q.eq("clientId", args.clientId))
      .first();
    return {
      retentionMonths: data.retentionMonths,
      cutoff: cutoff.getTime(),
      pastRetention: Math.min(rows.length, 1000),
      pastRetentionCapped: rows.length > 1000,
      oldestRecordAt: oldest?.createdAt ?? null,
    };
  },
});
