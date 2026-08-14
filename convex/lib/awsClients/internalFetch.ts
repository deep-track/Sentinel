// Base URLs for internal-only AWS services (Section 3.3, 9). These are
// never reachable from outside the VPC per the infra design — Convex is
// the only caller. Store the base URL + any shared auth as env vars,
// never hardcode.
//
// These calls must only ever happen inside a Convex action (never a
// query or mutation) since they're non-deterministic network calls to
// services outside Convex's control.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name} — set it in the Convex deployment's environment variables.`,
    );
  }
  return value;
}

export async function callInternalService<TResponse>(
  path: string,
  body: unknown,
  opts?: { timeoutMs?: number },
): Promise<TResponse> {
  const baseUrl = requireEnv("SENTINEL_INTERNAL_API_BASE_URL");
  const internalAuthToken = requireEnv("SENTINEL_INTERNAL_API_TOKEN");

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts?.timeoutMs ?? 10_000,
  );

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${internalAuthToken}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Internal service ${path} returned ${res.status}: ${text}`);
    }

    return (await res.json()) as TResponse;
  } finally {
    clearTimeout(timeout);
  }
}