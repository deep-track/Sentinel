import "server-only";

import { headers } from "next/headers";

/**
 * The visitor's IP address as seen by the hosting edge. On Vercel both
 * x-real-ip and the first x-forwarded-for entry are set by the platform
 * (client-sent values are overwritten), so they can be trusted there.
 */
export async function requestIp(): Promise<string | null> {
  const store = await headers();
  const real = store.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = store.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || null;
}
