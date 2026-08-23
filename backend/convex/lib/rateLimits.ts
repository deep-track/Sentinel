import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";

type RateLimiterComponent = ConstructorParameters<typeof RateLimiter>[0];

const rateLimiterComponent = (components as { rateLimiter: RateLimiterComponent }).rateLimiter;

export const rateLimiter = new RateLimiter(rateLimiterComponent, {
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

export async function checkApiRateLimit(
  ctx: { runMutation: any; runQuery: any },
  plan: ClientPlan,
  apiKeyId: string,
): Promise<{ ok: true } | { ok: false; retryAfterMs: number }> {
  const limiterName = limiterNameForPlan(plan);
  const result = await rateLimiter.limit(ctx as any, limiterName, { key: apiKeyId });
  if (result.ok === true) return { ok: true };
  return { ok: false, retryAfterMs: result.retryAfter };
}
