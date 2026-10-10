import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";

type RateLimiterComponent = ConstructorParameters<typeof RateLimiter>[0];

const rateLimiterComponent = (components as { rateLimiter: RateLimiterComponent }).rateLimiter;

export const rateLimiter = new RateLimiter(rateLimiterComponent, {
  publicApiTrial: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 10 },
  publicApiStarter: { kind: "token bucket", rate: 60, period: MINUTE, capacity: 10 },
  publicApiGrowth: { kind: "token bucket", rate: 200, period: MINUTE, capacity: 30 },
  publicApiEnterprise: { kind: "token bucket", rate: 1000, period: MINUTE, capacity: 100 },
  // Failed API-key authentications per caller (IP when known, else key
  // prefix). Checked before authentication so brute-force / prefix
  // enumeration is throttled without touching legitimate traffic.
  publicApiAuthFailures: { kind: "token bucket", rate: 20, period: MINUTE, capacity: 20 },
});

export type ClientPlan = "trial" | "starter" | "growth" | "enterprise";

type RateLimitCtx = Pick<ActionCtx, "runMutation" | "runQuery">;
type RateLimitResult = { ok: true } | { ok: false; retryAfterMs: number };

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
  ctx: RateLimitCtx,
  plan: ClientPlan,
  apiKeyId: string,
): Promise<RateLimitResult> {
  const limiterName = limiterNameForPlan(plan);
  const result = await rateLimiter.limit(ctx, limiterName, { key: apiKeyId });
  if (result.ok === true) return { ok: true };
  return { ok: false, retryAfterMs: result.retryAfter };
}

// Per-client requests-per-minute cap (clients.rpmCap), applied on top of the
// plan limit. A non-positive / non-finite cap means "no extra cap".
export async function checkClientRpmCap(
  ctx: RateLimitCtx,
  clientId: string,
  rpmCap: number,
): Promise<RateLimitResult> {
  if (!Number.isFinite(rpmCap) || rpmCap <= 0) return { ok: true };
  const rate = Math.max(1, Math.floor(rpmCap));
  const result = await rateLimiter.limit(ctx, "clientRpmCap", {
    key: clientId,
    config: { kind: "fixed window", rate, period: MINUTE },
  });
  if (result.ok === true) return { ok: true };
  return { ok: false, retryAfterMs: result.retryAfter };
}

// Read-only check (consumes nothing) run before authenticating a request.
export async function checkAuthFailureBudget(
  ctx: RateLimitCtx,
  callerKey: string,
): Promise<RateLimitResult> {
  const result = await rateLimiter.check(ctx, "publicApiAuthFailures", { key: callerKey });
  if (result.ok === true) return { ok: true };
  return { ok: false, retryAfterMs: result.retryAfter };
}

// Consumes one token for a failed authentication attempt.
export async function recordAuthFailure(ctx: RateLimitCtx, callerKey: string): Promise<void> {
  await rateLimiter.limit(ctx, "publicApiAuthFailures", { key: callerKey });
}
