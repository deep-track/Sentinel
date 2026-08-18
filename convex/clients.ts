import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireClientRole } from "./lib/rbac";
import { randomKeySegment } from "./lib/crypto";

// only an active Client Admin or Developer can register/rotate its webhook.
export const registerWebhook = mutation({
  args: {
    clientId: v.id("clients"),
    webhookUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await requireClientRole(ctx, args.clientId, ["client_admin", "developer"]);
    const webhookSecret = randomKeySegment(32);
    await ctx.db.patch(args.clientId, {
      webhookUrl: args.webhookUrl,
      webhookSecret,
    });
    return { webhookSecret };
  },
});