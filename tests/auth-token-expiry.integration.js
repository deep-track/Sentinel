const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// Transpile a TS module to CommonJS and evaluate it, resolving its imports
// through `stubs` (falling back to the real require).
function loadTs(file, stubs = {}) {
  const { outputText } = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  });
  const module = { exports: {} };
  const localRequire = (name) => (name in stubs ? stubs[name] : require(name));
  new Function("exports", "require", "module", outputText)(module.exports, localRequire, module);
  return module.exports;
}

const expiry = loadTs("backend/lib/token-expiry.ts");

function fakeJwt(claims) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}.signature`;
}

function loadRoute(session) {
  return loadTs("app/api/auth/token/route.ts", {
    "next/server": {
      NextResponse: {
        json: (body, init = {}) => ({ body, status: init.status ?? 200, headers: init.headers ?? {} }),
      },
    },
    "@/backend/lib/auth": { getValidatedSession: async () => session },
    "@/backend/lib/token-expiry": expiry,
  });
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

test("token route returns 401 expired for an ID token past its exp", async () => {
  const idToken = fakeJwt({ sub: "auth0|u1", exp: nowSeconds() - 280 * 60 });
  const res = await loadRoute({ user: { sub: "auth0|u1" }, tokenSet: { idToken } }).GET();
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { token: null, reason: "expired" });
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("token route treats a token expiring within 60 s as expired", async () => {
  const idToken = fakeJwt({ sub: "auth0|u1", exp: nowSeconds() + 30 });
  const res = await loadRoute({ user: { sub: "auth0|u1" }, tokenSet: { idToken } }).GET();
  assert.equal(res.status, 401);
  assert.equal(res.body.reason, "expired");
});

test("token route returns a token with more than 60 s left", async () => {
  const idToken = fakeJwt({ sub: "auth0|u1", exp: nowSeconds() + 3600 });
  const res = await loadRoute({ user: { sub: "auth0|u1" }, tokenSet: { idToken } }).GET();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { token: idToken });
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("token route keeps returning 200 with no token when signed out", async () => {
  const res = await loadRoute(null).GET();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { token: null });
});

test("isTokenExpiring uses a 60 s window and rejects a missing exp", () => {
  const now = 1_700_000_000_000;
  const nowS = now / 1000;
  assert.equal(expiry.TOKEN_EXPIRY_SKEW_SECONDS, 60);
  assert.equal(expiry.isTokenExpiring(nowS - 1, now), true);
  assert.equal(expiry.isTokenExpiring(nowS + 60, now), true);
  assert.equal(expiry.isTokenExpiring(nowS + 61, now), false);
  assert.equal(expiry.isTokenExpiring(undefined, now), true);
  assert.equal(expiry.isTokenExpiring("123", now), true);
});

test("re-login loop guard allows one redirect per 60 s", () => {
  const now = 1_700_000_000_000;
  assert.equal(expiry.RELOGIN_GUARD_MS, 60_000);
  assert.equal(expiry.shouldAttemptRelogin(null, now), true);
  assert.equal(expiry.shouldAttemptRelogin(Number.NaN, now), true);
  assert.equal(expiry.shouldAttemptRelogin(now - 5_000, now), false);
  assert.equal(expiry.shouldAttemptRelogin(now - 59_999, now), false);
  assert.equal(expiry.shouldAttemptRelogin(now - 60_000, now), true);
});

test("public pages never trigger a re-login redirect", () => {
  for (const p of ["/", "/sign-in", "/sign-in/x", "/logged-out", "/auth/login"]) {
    assert.equal(expiry.isReloginExemptPath(p), true, p);
  }
  for (const p of ["/internal-ops/overview", "/liveness", "/sign-in-foo", "/authz"]) {
    assert.equal(expiry.isReloginExemptPath(p), false, p);
  }
});

test("re-login URL returns to the current path and query", () => {
  assert.equal(
    expiry.buildReloginUrl("/internal-ops/overview", "?tab=queue&x=1"),
    "/auth/login?returnTo=%2Finternal-ops%2Foverview%3Ftab%3Dqueue%26x%3D1",
  );
});

test("Convex provider fetches the token with no-store and recovers on expired", () => {
  const source = read("components/convex-client-provider.tsx");
  assert.match(source, /fetch\("\/api\/auth\/token", \{ cache: "no-store" \}\)/);
  assert.doesNotMatch(source, /cache: forceRefreshToken/);
  assert.match(source, /res\.status === 401 && body\?\.reason === "expired"/);
  assert.match(source, /isReloginExemptPath\(pathname\)/);
  assert.match(source, /shouldAttemptRelogin\(readLastReloginAt\(\), now\)/);
  assert.match(source, /writeLastReloginAt\(now\);\s*window\.location\.assign\(buildReloginUrl\(pathname, search\)\)/);
  assert.match(source, /window\.sessionStorage/);
});
