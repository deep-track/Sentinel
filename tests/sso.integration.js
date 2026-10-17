const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadTs(relative, stubs = {}, cache = new Map()) {
  if (cache.has(relative)) return cache.get(relative);
  const { outputText } = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: relative,
  });
  const module = { exports: {} };
  cache.set(relative, module.exports);
  const localRequire = (specifier) => {
    if (specifier in stubs) return stubs[specifier];
    if (!specifier.startsWith(".")) return require(specifier);
    const resolved = path.resolve(path.dirname(path.join(root, relative)), specifier);
    return loadTs(path.relative(root, resolved.endsWith(".ts") ? resolved : `${resolved}.ts`), stubs, cache);
  };
  new Function("exports", "require", "module", outputText)(module.exports, localRequire, module);
  return module.exports;
}

const server = { mutation: (d) => d, query: (d) => d, internalMutation: (d) => d, internalQuery: (d) => d };
const audits = [];
const stubs = {
  "./_generated/server": server,
  "./lib/rbac": { requireClientRole: async (ctx) => ({ userId: (await ctx.auth.getUserIdentity())?.subject ?? "admin", role: "client_admin" }) },
  "./auditLog": { recordAudit: async (_ctx, entry) => audits.push(entry), actorTypeForClientRole: () => "client_user" },
  "./reviewQueue": { displayName: () => "Admin" },
};
const sso = loadTs("backend/convex/sso.ts", stubs);

test("SSO domains are real company domains", () => {
  assert.deepEqual(sso.cleanSsoDomains(["@KCB.co.ke", "kcb.co.ke", " ke.kcb.co.ke "]), ["kcb.co.ke", "ke.kcb.co.ke"]);
  assert.throws(() => sso.cleanSsoDomains([]), /at least one email domain/);
  assert.throws(() => sso.cleanSsoDomains(["gmail.com"]), /public email domain/);
  assert.throws(() => sso.cleanSsoDomains(["deeptrack.io"]), /public email domain/, "DeepTrack's own domain can't be claimed");
  assert.throws(() => sso.cleanSsoDomains(["not a domain"]), /not a valid email domain/);
});

test("SSO is required only for connected, enforced domains", () => {
  const connected = { status: "connected", provider: "entra_id", connectionName: "sso-abc", domains: ["kcb.co.ke"], enforce: true };
  assert.deepEqual(sso.ssoRequirement(connected, "Jane@KCB.co.ke"), { connectionName: "sso-abc" });
  assert.equal(sso.ssoRequirement(connected, "auditor@pwc.com"), null, "other domains sign in as before");
  assert.equal(sso.ssoRequirement({ ...connected, enforce: false }, "jane@kcb.co.ke"), null);
  assert.equal(sso.ssoRequirement({ ...connected, status: "pending" }, "jane@kcb.co.ke"), null);
  assert.equal(sso.ssoRequirement(undefined, "jane@kcb.co.ke"), null);
});

function fakeDb(tables) {
  let next = 1;
  return {
    get: async (id) => Object.values(tables).flat().find((row) => row._id === id) ?? null,
    insert: async (table, row) => {
      const _id = `${table}:${next++}`;
      (tables[table] ??= []).push({ _id, ...row });
      return _id;
    },
    patch: async (id, changes) => Object.assign(Object.values(tables).flat().find((row) => row._id === id), changes),
    query: (table) => {
      let filters = [];
      const query = {
        withIndex: (_name, build) => {
          const builder = { eq: (field, value) => ((filters = [...filters, [field, value]]), builder) };
          if (build) build(builder);
          return query;
        },
        take: async (n) => (tables[table] ?? []).filter((row) => filters.every(([field, value]) => row[field] === value)).slice(0, n),
        unique: async () => (tables[table] ?? []).find((row) => filters.every(([field, value]) => row[field] === value)) ?? null,
      };
      return query;
    },
  };
}

function setup({ jitRole = "viewer", seatLimit } = {}) {
  const team = loadTs("backend/convex/team.ts", { ...stubs, "./lib/clientSettings": loadTs("backend/convex/lib/clientSettings.ts") });
  const tables = {
    clients: [{ _id: "c1", status: "active", ...(seatLimit ? { seatLimit } : {}) }],
    clientSettings: [{ _id: "s1", clientId: "c1", ssoConnectionName: "sso-abc", sso: { status: "connected", provider: "entra_id", connectionName: "sso-abc", domains: ["kcb.co.ke"], enforce: true, ...(jitRole ? { jitRole } : {}) } }],
    clientMembers: [],
    teamInvites: [],
  };
  return { team, tables, db: fakeDb(tables) };
}

test("someone signing in through the client's SSO joins with the chosen role", async () => {
  const { team, tables, db } = setup();
  const identity = { subject: "waad|sso-abc|jane", email: "jane@kcb.co.ke", "https://deeptrack.io/connection": "sso-abc" };
  assert.deepEqual(await team.acceptMyInvites.handler({ db, auth: { getUserIdentity: async () => identity } }, {}), { accepted: 1 });
  assert.equal(tables.clientMembers[0].role, "viewer");
  assert.equal(tables.clientMembers[0].invitedBy, "sso");
  assert.equal(audits.at(-1).action, "team.sso_provisioned");
  assert.deepEqual(await team.acceptMyInvites.handler({ db, auth: { getUserIdentity: async () => identity } }, {}), { accepted: 0 }, "once");
});

test("no SSO membership without the connection, the domain, a role or a free seat", async () => {
  const cases = [
    [{}, { subject: "auth0|x", email: "jane@kcb.co.ke" }],
    [{}, { subject: "waad|x", email: "jane@gmail.com", "https://deeptrack.io/connection": "sso-abc" }],
    [{}, { subject: "waad|x", email: "jane@kcb.co.ke", "https://deeptrack.io/connection": "sso-other" }],
    [{ jitRole: null }, { subject: "waad|x", email: "jane@kcb.co.ke", "https://deeptrack.io/connection": "sso-abc" }],
  ];
  for (const [options, identity] of cases) {
    const { team, tables, db } = setup(options);
    await team.acceptMyInvites.handler({ db, auth: { getUserIdentity: async () => identity } }, {});
    assert.equal(tables.clientMembers.length, 0, JSON.stringify(identity));
  }
  const full = setup({ seatLimit: 1 });
  full.tables.clientMembers.push({ _id: "m0", clientId: "c1", userId: "someone", role: "client_admin", isActive: true, createdAt: 1 });
  await full.team.acceptMyInvites.handler({ db: full.db, auth: { getUserIdentity: async () => ({ subject: "waad|y", email: "y@kcb.co.ke", "https://deeptrack.io/connection": "sso-abc" }) } }, {});
  assert.equal(full.tables.clientMembers.length, 1, "seat limit respected");
});

test("wiring: Convex authorizes before Auth0 changes; secrets go only to Auth0", () => {
  const actions = read("app/(platform)/settings/security/sso-actions.ts");
  assert.ok(actions.indexOf("anyApi.sso.authorizeConnect") < actions.indexOf("createEnterpriseConnection({"), "authorize, then create");
  assert.ok(actions.indexOf("anyApi.sso.authorizeRemove") < actions.indexOf("deleteEnterpriseConnection(connectionId)"), "authorize, then delete");
  assert.doesNotMatch(read("backend/convex/sso.ts"), /clientSecret|client_secret|signingCert/, "no IdP secrets in Convex");
  const source = read("backend/convex/sso.ts");
  for (const fn of ["authorizeConnect", "recordConnected", "setOptions", "authorizeRemove", "recordRemoved"]) {
    assert.match(source, new RegExp(`export const ${fn} = mutation\\(\\{[\\s\\S]*?requireClientRole\\(ctx, args\\.clientId, \\["client_admin"\\]\\)`), fn);
  }
  assert.match(source, /is already used for single sign-on by another organization/);
  assert.match(read("auth0/sentinel-role-claims-action.js"), /api\.idToken\.setCustomClaim\(`\$\{namespace\}\/connection`, event\.connection\.name\)/);
  assert.match(read("app/(platform)/layout.tsx"), /if \(active && gate\.sso && \(await sessionConnection\(\)\) !== gate\.sso\.connectionName\)/);
  assert.match(read("backend/convex/orgSettings.ts"), /sso: ssoRequirement\(row\?\.sso,/);
});
