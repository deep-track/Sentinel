// Machine-readable failure codes. These are the ONLY details about an upstream
// failure that may be persisted on a verification or sent to a client: raw
// upstream bodies can contain stack traces, internal hostnames or echoed PII.
export type UpstreamErrorCode =
  | "upstream_timeout"
  | "upstream_unavailable"
  | "upstream_http_error"
  | "upstream_invalid_response"
  | "upstream_misconfigured";

export class UpstreamServiceError extends Error {
  readonly code: UpstreamErrorCode;
  readonly status?: number;

  constructor(code: UpstreamErrorCode, message: string, status?: number) {
    super(message);
    this.name = "UpstreamServiceError";
    this.code = code;
    this.status = status;
  }
}

// Maps any thrown value to a generic, client-safe error code.
export function upstreamErrorCode(err: unknown): UpstreamErrorCode | "internal_error" {
  return err instanceof UpstreamServiceError ? err.code : "internal_error";
}

// Transient failures worth retrying. Invalid responses and 4xx are not.
export function isRetryableUpstreamError(err: unknown): boolean {
  if (!(err instanceof UpstreamServiceError)) return false;
  if (err.code === "upstream_timeout" || err.code === "upstream_unavailable") return true;
  return err.code === "upstream_http_error" && (err.status === 429 || (err.status ?? 0) >= 500);
}

const LOGGED_BODY_LIMIT = 300;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new UpstreamServiceError(
      "upstream_misconfigured",
      `Missing required env var ${name}: set it in the Convex deployment's environment variables.`,
    );
  }
  return value;
}

function isAbortError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
}

// Returns the parsed JSON body as `unknown`. Every caller must validate the
// shape at runtime before trusting it.
export async function callInternalService(
  path: string,
  body: unknown,
  opts?: { timeoutMs?: number },
): Promise<unknown> {
  const baseUrl = requireEnv("SENTINEL_INTERNAL_API_BASE_URL");
  const internalAuthToken = requireEnv("SENTINEL_INTERNAL_API_TOKEN");

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts?.timeoutMs ?? 10_000,
  );

  try {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${internalAuthToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        throw new UpstreamServiceError("upstream_timeout", `Internal service ${path} timed out`);
      }
      console.error(`[internalFetch] ${path} request failed`, err instanceof Error ? err.message : "unknown error");
      throw new UpstreamServiceError("upstream_unavailable", `Internal service ${path} is unavailable`);
    }

    if (!res.ok) {
      // Log a truncated body server-side for debugging; never put it in the
      // thrown message, which can reach verification results and webhooks.
      const text = await res.text().catch(() => "");
      console.error(
        `[internalFetch] ${path} returned HTTP ${res.status}: ${text.slice(0, LOGGED_BODY_LIMIT)}`,
      );
      throw new UpstreamServiceError(
        "upstream_http_error",
        `Internal service ${path} returned HTTP ${res.status}`,
        res.status,
      );
    }

    try {
      return (await res.json()) as unknown;
    } catch (err) {
      if (isAbortError(err)) {
        throw new UpstreamServiceError("upstream_timeout", `Internal service ${path} timed out`);
      }
      throw new UpstreamServiceError(
        "upstream_invalid_response",
        `Internal service ${path} returned a non-JSON response`,
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

// Small runtime validators shared by the service clients. Anything unexpected
// is an invalid response, so the risk engine routes it to review.
export function invalidResponse(path: string, detail: string): UpstreamServiceError {
  console.error(`[internalFetch] ${path} returned an unexpected shape: ${detail}`);
  return new UpstreamServiceError(
    "upstream_invalid_response",
    `Internal service ${path} returned an unexpected response`,
  );
}

export function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidResponse(path, "body is not an object");
  }
  return value as Record<string, unknown>;
}

export function readNumber(
  record: Record<string, unknown>,
  key: string,
  path: string,
  range: { min: number; max: number },
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < range.min || value > range.max) {
    throw invalidResponse(path, `${key} is not a number in [${range.min}, ${range.max}]`);
  }
  return value;
}

export function readString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== "string") throw invalidResponse(path, `${key} is not a string`);
  return value;
}

export function readBoolean(record: Record<string, unknown>, key: string, path: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw invalidResponse(path, `${key} is not a boolean`);
  return value;
}

export function readArray(record: Record<string, unknown>, key: string, path: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw invalidResponse(path, `${key} is not an array`);
  return value;
}
