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