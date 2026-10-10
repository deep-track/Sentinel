import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireClientRole } from "./lib/rbac";
import { randomKeySegment } from "./lib/crypto";
import { assertSafeWebhookUrl } from "./lib/urlSafety";
import { actorTypeForClientRole, recordAudit } from "./auditLog";

// Only an active Client Admin can register/rotate its webhook: the endpoint
// receives every verification result, so it is an admin-level setting.
// The URL must be public https (see lib/urlSafety.ts).
export const registerWebhook = mutation({
  args: {
    clientId: v.id("clients"),
    webhookUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireClientRole(ctx, args.clientId, ["client_admin"]);
    const webhookUrl = assertSafeWebhookUrl(args.webhookUrl);
    const client = await ctx.db.get(args.clientId);
    const webhookSecret = randomKeySegment(32);
    await ctx.db.patch(args.clientId, {
      webhookUrl,
      webhookSecret,
    });
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
        previousHost: client?.webhookUrl ? safeHost(client.webhookUrl) : null,
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
