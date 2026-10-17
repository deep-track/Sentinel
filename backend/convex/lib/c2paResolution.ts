// C2PA Soft Binding Resolution API client (spec 2.3.0) for IDP.
//
// Fraudsters strip embedded content credentials by screenshotting or
// re-saving an image. A soft binding (an invisible watermark or a perceptual
// fingerprint) survives that. A resolution service matches the uploaded
// document image to C2PA manifests registered by AI generators and editing
// tools, and this client reads those manifests for signs that the image was
// AI-generated or edited.
//
//   POST {base}/matches/byContent?maxResults=…   image bytes → manifest ids
//   GET  {endpoint ?? base}/manifests/{id}?returnActiveManifest=true
//
// Auth: OAuth 2.0 client credentials (scope fetch:manifests), or none when the
// service is open (the spec allows an empty security requirement).
// No Convex imports; fetch is injected, so this file is unit tested directly.

import { checkOutboundUrl } from "./urlSafety";
import type { FraudFlag } from "./documentChecks";

export const C2PA_MAX_RESULTS = 5;
// Matches below this similarity (0–100) are too weak to act on.
export const C2PA_MIN_SIMILARITY = 70;
const TIMEOUT_MS = 15_000;
const MAX_MANIFEST_BYTES = 2_000_000;
const MAX_MANIFESTS_FETCHED = 3;

export type C2paConfig = {
  baseUrl: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  // Soft binding algorithm to ask for (from the C2PA algorithm list); the
  // service picks one when omitted.
  alg?: string;
};

export type C2paMatch = { manifestId: string; endpoint: string | null; similarityScore: number | null };

export type C2paManifestFinding = {
  manifestId: string;
  similarityScore: number | null;
  digitalSourceType: "ai_generated" | "ai_composite" | "digital_capture" | "other" | "unknown";
  claimGenerator: string | null;
  edited: boolean;
};

export type C2paOutcome =
  | { status: "checked"; matches: number; findings: C2paManifestFinding[]; flags: FraudFlag[] }
  | { status: "not_configured" | "unavailable" | "unsupported_file" };

export class C2paError extends Error {}

// Reads the C2PA configuration from the Convex environment. Returns null
// unless at least the service URL is set.
export function c2paConfigFromEnv(env: Record<string, string | undefined>): C2paConfig | null {
  const baseUrl = env.C2PA_RESOLUTION_URL?.trim();
  if (!baseUrl) return null;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    tokenUrl: env.C2PA_TOKEN_URL?.trim() || undefined,
    clientId: env.C2PA_CLIENT_ID?.trim() || undefined,
    clientSecret: env.C2PA_CLIENT_SECRET?.trim() || undefined,
    scope: env.C2PA_SCOPE?.trim() || "fetch:manifests",
    alg: env.C2PA_ALG?.trim() || undefined,
  };
}

async function timedFetch(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw new C2paError(controller.signal.aborted ? "C2PA request timed out" : `C2PA request failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

function safeUrl(raw: string, label: string): string {
  const check = checkOutboundUrl(raw);
  if (!check.ok) throw new C2paError(`${label} is not a public https URL`);
  return check.url;
}

export async function fetchAccessToken(config: C2paConfig, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (!config.tokenUrl || !config.clientId || !config.clientSecret) return null;
  const response = await timedFetch(fetchImpl, safeUrl(config.tokenUrl, "C2PA_TOKEN_URL"), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", ...(config.scope ? { scope: config.scope } : {}) }).toString(),
  });
  if (!response.ok) throw new C2paError(`C2PA token request returned HTTP ${response.status}`);
  const body = (await response.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string" || !body.access_token) throw new C2paError("C2PA token response has no access_token");
  return body.access_token;
}

export function parseMatches(raw: unknown): C2paMatch[] {
  const matches = (raw as { matches?: unknown } | null)?.matches;
  if (matches === undefined) return [];
  if (!Array.isArray(matches)) throw new C2paError("C2PA response has no matches array");
  return matches
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof (item as { manifestId?: unknown }).manifestId === "string")
    .map((item) => ({
      manifestId: (item.manifestId as string).slice(0, 300),
      endpoint: typeof item.endpoint === "string" ? item.endpoint : null,
      similarityScore: typeof item.similarityScore === "number" ? Math.max(0, Math.min(100, item.similarityScore)) : null,
    }));
}

export async function matchByContent(
  config: C2paConfig,
  bytes: Uint8Array,
  mediaType: string,
  token: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<C2paMatch[]> {
  const url = new URL(`${safeUrl(config.baseUrl, "C2PA_RESOLUTION_URL")}/matches/byContent`);
  url.searchParams.set("maxResults", String(C2PA_MAX_RESULTS));
  if (config.alg) url.searchParams.set("alg", config.alg);
  const response = await timedFetch(fetchImpl, url.toString(), {
    method: "POST",
    headers: { "Content-Type": mediaType, Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: new Blob([bytes as BlobPart], { type: mediaType }),
  });
  if (response.status === 415) throw new C2paError("C2PA service does not accept this file type");
  if (!response.ok) throw new C2paError(`C2PA match returned HTTP ${response.status}`);
  return parseMatches(await response.json());
}

// A match's manifest may live on another resolution service (`endpoint`);
// only public https endpoints are followed.
export async function fetchManifest(
  config: C2paConfig,
  match: C2paMatch,
  token: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const base = match.endpoint ? safeUrl(match.endpoint.replace(/\/+$/, ""), "C2PA match endpoint") : safeUrl(config.baseUrl, "C2PA_RESOLUTION_URL");
  const url = new URL(`${base.replace(/\/+$/, "")}/manifests/${encodeURIComponent(match.manifestId)}`);
  url.searchParams.set("returnActiveManifest", "true");
  const sameService = !match.endpoint || new URL(base).host === new URL(config.baseUrl).host;
  const response = await timedFetch(fetchImpl, url.toString(), {
    method: "GET",
    // Our token is only sent to the configured service.
    headers: { Accept: "application/c2pa", ...(token && sameService ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!response.ok) throw new C2paError(`C2PA manifest returned HTTP ${response.status}`);
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.length > MAX_MANIFEST_BYTES) throw new C2paError("C2PA manifest is too large");
  return buffer;
}

// Known generators, matched in a manifest's claim_generator / softwareAgent.
// Specific product names only: a camera maker's name (e.g. Google Pixel) must
// not read as an AI generator.
const AI_GENERATOR_NAMES = ["openai", "dall-e", "dall·e", "chatgpt", "adobe firefly", "midjourney", "stable diffusion", "stability ai", "imagen", "gemini", "bing image creator", "microsoft designer", "meta ai", "ideogram", "leonardo.ai", "runway", "black forest labs", "flux.1"];

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index++) {
    const code = bytes[index];
    out += code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : " ";
  }
  return out;
}

// Reads the facts Sentinel needs from a manifest (JUMBF / CBOR). The labels and
// IPTC source-type URIs are stored as plain strings, so they can be read
// without a full CBOR decoder. Signatures are not validated here.
export function interpretManifest(bytes: Uint8Array, match: C2paMatch): C2paManifestFinding {
  const text = latin1(bytes);
  const lower = text.toLowerCase();
  let digitalSourceType: C2paManifestFinding["digitalSourceType"] = "unknown";
  if (lower.includes("compositewithtrainedalgorithmicmedia")) digitalSourceType = "ai_composite";
  else if (lower.includes("trainedalgorithmicmedia")) digitalSourceType = "ai_generated";
  else if (lower.includes("digitalcapture")) digitalSourceType = "digital_capture";
  else if (lower.includes("digitalsourcetype")) digitalSourceType = "other";

  const generatorMatch = text.match(/claim_generator[^A-Za-z0-9]{0,6}([A-Za-z0-9][^\x00]{1,80}?)(?:\s{2,}|$)/);
  const claimGenerator = generatorMatch ? generatorMatch[1].trim().slice(0, 80) : AI_GENERATOR_NAMES.find((name) => lower.includes(name)) ?? null;
  if (digitalSourceType === "unknown" && claimGenerator && AI_GENERATOR_NAMES.some((name) => claimGenerator.toLowerCase().includes(name))) {
    digitalSourceType = "ai_generated";
  }
  const edited = /c2pa\.(edited|color_adjustments|cropped|drawing|filtered|placed|removed|transcoded|repackaged)/.test(lower);
  return { manifestId: match.manifestId, similarityScore: match.similarityScore, digitalSourceType, claimGenerator, edited };
}

export function c2paFlags(findings: C2paManifestFinding[]): FraudFlag[] {
  const flags: FraudFlag[] = [];
  const ai = findings.find((finding) => finding.digitalSourceType === "ai_generated");
  const composite = findings.find((finding) => finding.digitalSourceType === "ai_composite");
  const edited = findings.find((finding) => finding.edited && finding.digitalSourceType !== "ai_generated");
  const by = (finding: C2paManifestFinding) => (finding.claimGenerator ? ` (${finding.claimGenerator})` : "");
  const score = (finding: C2paManifestFinding) => (finding.similarityScore === null ? "" : `, ${finding.similarityScore}% match`);
  if (ai) {
    flags.push({
      code: "c2pa_registry_ai_generated",
      severity: "critical",
      source: "file",
      message: `A registered content credential matching this image says it was generated by AI${by(ai)}${score(ai)}.`,
    });
  } else if (composite) {
    flags.push({
      code: "c2pa_registry_ai_composite",
      severity: "high",
      source: "file",
      message: `A registered content credential matching this image says it was partly made with generative AI${by(composite)}${score(composite)}.`,
    });
  }
  if (edited) {
    flags.push({
      code: "c2pa_registry_edited",
      severity: "medium",
      source: "file",
      message: `A registered content credential matching this image records edits${by(edited)}${score(edited)}.`,
    });
  }
  return flags;
}

// Full lookup for one document image. Never throws: failures are "unavailable".
export async function lookupContentCredentials(
  config: C2paConfig | null,
  bytes: Uint8Array,
  mediaType: string,
  options: { fetchImpl?: typeof fetch; onError?: (error: unknown) => void } = {},
): Promise<C2paOutcome> {
  if (!config) return { status: "not_configured" };
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const token = await fetchAccessToken(config, fetchImpl);
    const matches = (await matchByContent(config, bytes, mediaType, token, fetchImpl)).filter(
      (match) => match.similarityScore === null || match.similarityScore >= C2PA_MIN_SIMILARITY,
    );
    const findings: C2paManifestFinding[] = [];
    for (const match of matches.slice(0, MAX_MANIFESTS_FETCHED)) {
      try {
        findings.push(interpretManifest(await fetchManifest(config, match, token, fetchImpl), match));
      } catch (error) {
        options.onError?.(error);
      }
    }
    return { status: "checked", matches: matches.length, findings, flags: c2paFlags(findings) };
  } catch (error) {
    options.onError?.(error);
    if (error instanceof C2paError && /does not accept this file type/.test(error.message)) return { status: "unsupported_file" };
    return { status: "unavailable" };
  }
}
