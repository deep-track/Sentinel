import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireClientRole } from "./lib/rbac";
import { randomKeySegment } from "./lib/crypto";
import { assertSafeWebhookUrl } from "./lib/urlSafety";
import { actorTypeForClientRole, recordAudit } from "./auditLog";
import { ensureEndpointsFor } from "./webhooks";
import { DEFAULT_ENDPOINT_EVENTS } from "./lib/webhookDispatch";

// Sets the client's first webhook endpoint and issues a new signing secret
// (the single-webhook flow from before endpoints; Settings → Developers
// manages endpoints with webhooks.createEndpoint and friends). An active
// Client Admin or Developer only: the endpoint receives every verification
// result. The URL must be public https (see lib/urlSafety.ts).
export const registerWebhook = mutation({
  args: {
    clientId: v.id("clients"),
    webhookUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireClientRole(ctx, args.clientId, ["client_admin", "developer"]);
    const webhookUrl = assertSafeWebhookUrl(args.webhookUrl);
    const webhookSecret = randomKeySegment(32);
    const [first] = await ensureEndpointsFor(ctx, args.clientId);
    const now = Date.now();
    if (first) {
      await ctx.db.patch(first._id, { url: webhookUrl, secret: webhookSecret, nextSecret: undefined, nextSecretCreatedAt: undefined, updatedAt: now });
    } else {
      await ctx.db.insert("webhookEndpoints", {
        clientId: args.clientId,
        url: webhookUrl,
        secret: webhookSecret,
        events: [...DEFAULT_ENDPOINT_EVENTS],
        environment: "all",
        status: "active",
        consecutiveFailures: 0,
        createdAt: now,
        createdBy: actor.userId,
        updatedAt: now,
      });
    }
    await recordAudit(ctx, {
      actorId: actor.userId,
      actorType: actorTypeForClientRole(actor.role),
      action: "webhook.configured",
      targetType: "webhook",
      targetId: args.clientId,
      clientId: args.clientId,
      // Never log the secret; the URL host is enough to trace changes.
      metadata: {
        role: actor.role,
        previousHost: first ? safeHost(first.url) : null,
        newHost: safeHost(webhookUrl),
        secretRotated: true,
      },
    });
    return { webhookSecret };
  },
});

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
