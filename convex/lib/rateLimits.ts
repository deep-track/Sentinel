import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";

// Section 10.3 lists 60/200/1000 RPM for Starter/Growth/Enterprise.
// Section 8.1's separate rate-limit table names a fourth, lower tier
// explicitly: "Sandbox: 10 RPM" — this is the trial plan under a
// different name across the two sections of the same doc, not an
// unspecified gap. Using 10, matching Section 8.1 exactly, rather
// than defaulting trial to Starter's rate.
export const rateLimiter = new RateLimiter(components.rateLimiter, {
  publicApiTrial: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 10 },
  publicApiStarter: { kind: "token bucket", rate: 60, period: MINUTE, capacity: 10 },
  publicApiGrowth: { kind: "token bucket", rate: 200, period: MINUTE, capacity: 30 },
  publicApiEnterprise: { kind: "token bucket", rate: 1000, period: MINUTE, capacity: 100 },
});

export type ClientPlan = "trial" | "starter" | "growth" | "enterprise";

const PLAN_TO_LIMITER: Record<ClientPlan, "publicApiTrial" | "publicApiStarter" | "publicApiGrowth" | "publicApiEnterprise"> = {
  trial: "publicApiTrial",
  starter: "publicApiStarter",
  growth: "publicApiGrowth",
  enterprise: "publicApiEnterprise",
};

export function limiterNameForPlan(plan: ClientPlan) {
  return PLAN_TO_LIMITER[plan];
}

// Keyed by api_key_id, not client_id — Section 8.1: "a client with
// multiple keys gets the limit per key." Call this from any http.ts
// route right after authenticateApiKey succeeds, before doing any
// real work.
export async function checkApiRateLimit(
  ctx: { runMutation: any; runQuery: any },
  plan: ClientPlan,
  apiKeyId: string,
): Promise<{ ok: true } | { ok: false; retryAfterMs: number }> {
  const limiterName = limiterNameForPlan(plan);
  const result = await rateLimiter.limit(ctx as any, limiterName, { key: apiKeyId });
  if (result.ok) return { ok: true };
  return { ok: false, retryAfterMs: result.retryAfter };
}