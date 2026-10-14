import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { loadClientSettings, lowCreditLevel, type NotificationEvent, PERSONAL_EVENTS } from "./lib/clientSettings";
import { queueClientEvent } from "./webhooks";

// Notifications for a client's team (Settings → Notifications): an in-app
// inbox per user, and an email when the event's settings ask for one and
// email is configured (RESEND_API_KEY and NOTIFICATIONS_FROM_EMAIL on the
// Convex deployment). Links are made absolute with SENTINEL_APP_URL
// (default https://sentinel.deeptrack.io).

const internalApi: any = internal;
const MAX_RECIPIENTS = 200;
const LIST_LIMIT = 50;
const DEFAULT_APP_URL = "https://sentinel.deeptrack.io";

type NotifyParams = {
  clientId: Id<"clients">;
  event: NotificationEvent;
  title: string;
  body: string;
  link?: string;
  // Personal events (assigned, awaiting approval) go to these people only.
  userIds?: string[];
};

// Writes the in-app notifications for an event, in the caller's
// transaction, and schedules the emails. Returns how many people it reached.
export async function notify(ctx: MutationCtx, params: NotifyParams): Promise<number> {
  const settings = await loadClientSettings(ctx, params.clientId);
  const eventSettings = settings.notifications.events[params.event];
  if (!eventSettings.enabled) return 0;

  const members = (
    await ctx.db
      .query("clientMembers")
      .withIndex("by_client", (q) => q.eq("clientId", params.clientId))
      .take(1000)
  ).filter((member) => member.isActive);
  const activeIds = new Set(members.map((member) => member.userId));
  const recipients = PERSONAL_EVENTS.includes(params.event)
    ? (params.userIds ?? []).filter((userId) => activeIds.has(userId))
    : members.filter((member) => eventSettings.roles.includes(member.role)).map((member) => member.userId);
  const unique = [...new Set(recipients)].slice(0, MAX_RECIPIENTS);
  if (unique.length === 0) return 0;

  const now = Date.now();
  const ids: Array<Id<"notifications">> = [];
  for (const userId of unique) {
    ids.push(
      await ctx.db.insert("notifications", {
        clientId: params.clientId,
        userId,
        event: params.event,
        title: params.title.slice(0, 200),
        body: params.body.slice(0, 1000),
        ...(params.link ? { link: params.link } : {}),
        emailStatus: eventSettings.email ? "queued" : "skipped",
        createdAt: now,
      }),
    );
  }
  if (eventSettings.email) {
    await ctx.scheduler.runAfter(0, internalApi.notifications.sendEmails, { notificationIds: ids });
  }
  return unique.length;
}

// Called after every ledger write (lib/credits.ts): alerts once when the
// balance falls to the client's warning level, and re-arms when it is
// topped up above it again.
export async function checkLowCredit(ctx: MutationCtx, clientId: Id<"clients">, balance: number) {
  const client = await ctx.db.get(clientId);
  if (!client) return;
  const settings = await loadClientSettings(ctx, clientId);
  const level = lowCreditLevel(client, settings.notifications);
  if (balance > level) {
    if (client.lowCreditNotifiedAt !== undefined) await ctx.db.patch(clientId, { lowCreditNotifiedAt: undefined });
    return;
  }
  if (client.lowCreditNotifiedAt !== undefined) return;
  await ctx.db.patch(clientId, { lowCreditNotifiedAt: Date.now() });
  await notify(ctx, {
    clientId,
    event: "low_credit",
    title: balance <= 0 ? "Out of credits" : `Low credits: ${balance.toLocaleString("en-US")} left`,
    body:
      balance <= 0
        ? "Your organization has no credits left, so new checks are refused. Contact DeepTrack to top up."
        : `Your balance is ${balance.toLocaleString("en-US")} credits, at or below your warning level of ${level.toLocaleString("en-US")}. Contact DeepTrack to top up before checks are refused.`,
    link: "/billing",
  });
  // And the sentinel.credits.low webhook, for endpoints that subscribe to it.
  await queueClientEvent(ctx, clientId, {
    event: "sentinel.credits.low",
    scan_id: `credits_${Date.now()}`,
    status: balance <= 0 ? "REJECT" : "REVIEW",
    timestamp: new Date().toISOString(),
    product: null,
    result: null,
    credits: { balance, warning_level: level },
  });
}

// ── Email ───────────────────────────────────────────────────────────────────

export const _forEmail = internalQuery({
  args: { notificationIds: v.array(v.id("notifications")) },
  handler: async (ctx, args) => {
    const rows = await Promise.all(args.notificationIds.map((id) => ctx.db.get(id)));
    return await Promise.all(
      rows
        .filter((row): row is Doc<"notifications"> => row !== null)
        .map(async (row) => {
          const [profile, client] = await Promise.all([
            ctx.db.query("userProfiles").withIndex("by_user_id", (q) => q.eq("userId", row.userId)).unique(),
            ctx.db.get(row.clientId),
          ]);
          return { _id: row._id, title: row.title, body: row.body, link: row.link ?? null, email: profile?.email ?? null, clientName: client?.name ?? "Sentinel" };
        }),
    );
  },
});

export const _setEmailStatus = internalMutation({
  args: { notificationId: v.id("notifications"), status: v.union(v.literal("sent"), v.literal("skipped"), v.literal("failed")) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.notificationId, { emailStatus: args.status });
  },
});

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function emailContent(params: { title: string; body: string; link: string | null; clientName: string; appUrl: string }) {
  const url = params.link ? new URL(params.link, params.appUrl).toString() : params.appUrl;
  const subject = `[Sentinel] ${params.title}`;
  const text = `${params.body}\n\nOpen in Sentinel: ${url}\n\nYou get this email as a member of ${params.clientName} on Sentinel. Your Admin chooses which alerts are emailed (Settings → Notifications).`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;max-width:560px">
<p style="font-size:16px;font-weight:bold;margin:0 0 12px">${escapeHtml(params.title)}</p>
<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(params.body)}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(url)}" style="background:#0f172a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open in Sentinel</a></p>
<p style="margin:0;font-size:12px;color:#64748b">You get this email as a member of ${escapeHtml(params.clientName)} on Sentinel by DeepTrack. Your Admin chooses which alerts are emailed (Settings → Notifications).</p>
</div>`;
  return { subject, text, html };
}

export const sendEmails = internalAction({
  args: { notificationIds: v.array(v.id("notifications")) },
  handler: async (ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.NOTIFICATIONS_FROM_EMAIL?.trim();
    const appUrl = process.env.SENTINEL_APP_URL?.trim() || DEFAULT_APP_URL;
    const rows: Array<{ _id: Id<"notifications">; title: string; body: string; link: string | null; email: string | null; clientName: string }> =
      await ctx.runQuery(internalApi.notifications._forEmail, { notificationIds: args.notificationIds });
    for (const row of rows) {
      if (!apiKey || !from || !row.email) {
        await ctx.runMutation(internalApi.notifications._setEmailStatus, { notificationId: row._id, status: "skipped" });
        continue;
      }
      const content = emailContent({ ...row, appUrl });
      let status: "sent" | "failed" = "failed";
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ from, to: [row.email], subject: content.subject, text: content.text, html: content.html }),
        });
        status = response.ok ? "sent" : "failed";
        if (!response.ok) console.error("[notifications] email rejected", response.status);
      } catch (error) {
        console.error("[notifications] email failed", error instanceof Error ? error.message.slice(0, 200) : "unknown");
      }
      await ctx.runMutation(internalApi.notifications._setEmailStatus, { notificationId: row._id, status });
    }
  },
});

// ── Inbox ───────────────────────────────────────────────────────────────────

async function currentUserId(ctx: { auth: { getUserIdentity: () => Promise<{ subject: string } | null> } }) {
  return (await ctx.auth.getUserIdentity())?.subject ?? null;
}

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await currentUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user_and_created_at", (q) => q.eq("userId", userId))
      .order("desc")
      .take(LIST_LIMIT);
    const clientIds = [...new Set(rows.map((row) => row.clientId))];
    const clients = await Promise.all(clientIds.map((id) => ctx.db.get(id)));
    const names = new Map(clients.filter((client): client is Doc<"clients"> => client !== null).map((client) => [client._id, client.name]));
    return rows.map((row) => ({
      _id: row._id,
      clientId: row.clientId,
      clientName: names.get(row.clientId) ?? null,
      event: row.event,
      title: row.title,
      body: row.body,
      link: row.link ?? null,
      read: row.readAt !== undefined,
      createdAt: row.createdAt,
    }));
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await currentUserId(ctx);
    if (!userId) return 0;
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user_and_read_at", (q) => q.eq("userId", userId).eq("readAt", undefined))
      .take(100);
    return rows.length;
  },
});

export const markRead = mutation({
  args: { notificationIds: v.optional(v.array(v.id("notifications"))) },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    if (!userId) return 0;
    const now = Date.now();
    const rows = args.notificationIds
      ? (await Promise.all(args.notificationIds.slice(0, 100).map((id) => ctx.db.get(id)))).filter(
          (row): row is Doc<"notifications"> => row !== null && row.userId === userId && row.readAt === undefined,
        )
      : await ctx.db
          .query("notifications")
          .withIndex("by_user_and_read_at", (q) => q.eq("userId", userId).eq("readAt", undefined))
          .take(500);
    for (const row of rows) await ctx.db.patch(row._id, { readAt: now });
    return rows.length;
  },
});
