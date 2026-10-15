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

const lib = loadTs("backend/convex/lib/signups.ts");

test("sign-up form: work email, name, organization and country", () => {
  assert.deepEqual(lib.cleanSignup({ name: " Jane  Wanjiru ", email: " Jane@AcmeBank.co.ke ", company: " Acme  Bank ", country: "ke" }), {
    name: "Jane Wanjiru",
    email: "jane@acmebank.co.ke",
    company: "Acme Bank",
    country: "KE",
  });
  assert.match(lib.cleanSignup({ name: "Jane", email: "jane@gmail.com", company: "Acme", country: "KE" }).error, /work email/);
  assert.match(lib.cleanSignup({ name: "Jane", email: "not-an-email", company: "Acme", country: "KE" }).error, /valid email/);
  assert.match(lib.cleanSignup({ name: "J", email: "j@acme.co.ke", company: "Acme", country: "KE" }).error, /full name/);
  assert.match(lib.cleanSignup({ name: "Jane", email: "j@acme.co.ke", company: "Acme", country: "Kenya" }).error, /country/);
  assert.equal(lib.currencyForCountry("KE"), "KES");
  assert.equal(lib.currencyForCountry("UG"), "USD");
  assert.equal(lib.isWorkEmail("cro@equitybank.co.ke"), true);
  assert.equal(lib.isWorkEmail("someone@outlook.com"), false);
});

function fakeDb(tables) {
  let next = 1;
  const find = (id) => {
    for (const rows of Object.values(tables)) {
      const row = rows.find((item) => item._id === id);
      if (row) return row;
    }
    return null;
  };
  return {
    get: async (id) => find(id),
    insert: async (table, row) => {
      const _id = `${table}:${next++}`;
      (tables[table] ??= []).push({ _id, ...row });
      return _id;
    },
    patch: async (id, changes) => {
      const row = find(id);
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) delete row[key];
        else row[key] = value;
      }
    },
    query: (table) => {
      const filters = [];
      const matching = () => (tables[table] ?? []).filter((row) => filters.every((check) => check(row)));
      const query = {
        withIndex: (_name, build) => {
          const builder = {
            eq: (field, value) => (filters.push((row) => row[field] === value), builder),
            gt: (field, value) => (filters.push((row) => row[field] > value), builder),
          };
          if (build) build(builder);
          return query;
        },
        order: () => query,
        take: async (n) => matching().slice(0, n),
        first: async () => matching()[0] ?? null,
        unique: async () => matching()[0] ?? null,
      };
      return query;
    },
  };
}

function setup(identity) {
  const record = { ledger: [], audits: [], notifications: [], scheduled: [] };
  const signups = loadTs("backend/convex/signups.ts", {
    "./_generated/server": { internalAction: (d) => d, internalMutation: (d) => d, mutation: (d) => d, query: (d) => d },
    "./_generated/api": { internal: { signups: { notifyDeepTrack: "notifyDeepTrack" } } },
    "./lib/credits": { recordLedgerEntry: async (_ctx, entry) => record.ledger.push(entry) },
    "./lib/rbac": { requireClientRole: async () => ({ userId: "u1", role: "client_admin" }) },
    "./auditLog": { recordAudit: async (_ctx, entry) => record.audits.push(entry) },
    "./notifications": { notify: async (_ctx, params) => record.notifications.push(params) },
  });
  const tables = { clients: [], clientMembers: [], clientSettings: [], signupRequests: [] };
  const ctx = {
    db: fakeDb(tables),
    auth: { getUserIdentity: async () => identity },
    scheduler: { runAfter: async (_ms, fn, args) => record.scheduled.push({ fn, args }) },
  };
  return { signups, tables, record, ctx };
}

const jane = { subject: "auth0|jane", email: "jane@acmebank.co.ke", emailVerified: true, name: "Jane Wanjiru" };

test("the /signup request is stored and rate-limited per email", async () => {
  const { signups, tables, ctx } = setup(null);
  const form = { name: "Jane Wanjiru", email: "Jane@AcmeBank.co.ke", company: "Acme Bank", country: "KE" };
  const first = await signups.request.handler(ctx, form);
  assert.equal(first.existingTrial, false);
  assert.equal(tables.signupRequests[0].email, "jane@acmebank.co.ke");
  await signups.request.handler(ctx, form);
  await signups.request.handler(ctx, form);
  await assert.rejects(signups.request.handler(ctx, form), /already sent an invitation/);
  await assert.rejects(signups.request.handler(ctx, { ...form, email: "jane@gmail.com" }), /work email/);
});

test("starting a trial creates the workspace, the Admin, the credits and the end date", async () => {
  const { signups, tables, record, ctx } = setup(jane);
  await signups.request.handler(ctx, { name: "Jane Wanjiru", email: "jane@acmebank.co.ke", company: "Acme Bank", country: "KE" });
  const status = await signups.myTrialStatus.handler(ctx, {});
  assert.equal(status.canStart, true);
  assert.deepEqual(status.prefill, { name: "Jane Wanjiru", company: "Acme Bank", country: "KE" });

  await assert.rejects(signups.startTrial.handler(ctx, { company: "Acme Bank", country: "KE", acceptTerms: false }), /terms/);
  const before = Date.now();
  const { clientId } = await signups.startTrial.handler(ctx, { company: "Acme Bank", country: "KE", phone: "+254700000000", acceptTerms: true });
  const client = tables.clients.find((row) => row._id === clientId);
  assert.equal(client.plan, "trial");
  assert.equal(client.status, "active");
  assert.equal(client.billingCurrency, "KES");
  assert.equal(client.signupDomain, "acmebank.co.ke");
  assert.ok(client.trialEndsAt >= before + 14 * 24 * 3600_000 - 1000);
  assert.deepEqual(record.ledger, [{ clientId, type: "allocation", amount: 25, reason: "Free trial credits (14 days)" }]);
  assert.deepEqual(tables.clientMembers.map((row) => [row.userId, row.role, row.isActive]), [["auth0|jane", "client_admin", true]]);
  assert.equal(tables.clientSettings[0].profile.legalName, "Acme Bank");
  assert.equal(tables.signupRequests[0].status, "completed");
  assert.equal(record.audits[0].action, "client.trial_started");
  assert.deepEqual(record.scheduled.map((item) => item.fn), ["notifyDeepTrack"]);

  // One trial per person and per company domain.
  await assert.rejects(signups.startTrial.handler(ctx, { company: "Acme 2", country: "KE", acceptTerms: true }), /already started a trial/);
  const colleague = setup({ ...jane, subject: "auth0|peter", email: "peter@acmebank.co.ke" });
  colleague.tables.clients.push({ ...client });
  colleague.ctx.db = fakeDb(colleague.tables);
  await assert.rejects(colleague.signups.startTrial.handler(colleague.ctx, { company: "Acme", country: "KE", acceptTerms: true }), /acmebank\.co\.ke already started a trial/);
});

test("no trial with an unverified or personal email, or for someone already in a workspace", async () => {
  const unverified = setup({ ...jane, emailVerified: false });
  await assert.rejects(unverified.signups.startTrial.handler(unverified.ctx, { company: "Acme", country: "KE", acceptTerms: true }), /Verify your email/);
  const personal = setup({ ...jane, email: "jane@gmail.com" });
  assert.match((await personal.signups.myTrialStatus.handler(personal.ctx, {})).reason, /work email/);
  const member = setup(jane);
  member.tables.clientMembers.push({ _id: "m1", clientId: "c9", userId: "auth0|jane", isActive: true });
  await assert.rejects(member.signups.startTrial.handler(member.ctx, { company: "Acme", country: "KE", acceptTerms: true }), /already belong/);
  const usd = setup({ ...jane, email: "ops@fintech.ug" });
  const { clientId } = await usd.signups.startTrial.handler(usd.ctx, { company: "Fintech UG", country: "UG", acceptTerms: true });
  assert.equal(usd.tables.clients.find((row) => row._id === clientId).billingCurrency, "USD");
  assert.equal(usd.record.ledger[0].amount, 1000, "US$10 of credits");
});

test("trials past their end date stop; others don't", async () => {
  const { signups, tables, record, ctx } = setup(null);
  const now = Date.now();
  tables.clients.push(
    { _id: "t1", plan: "trial", status: "active", trialEndsAt: now - 1000 },
    { _id: "t2", plan: "trial", status: "active", trialEndsAt: now + 1000 },
    { _id: "p1", plan: "starter", status: "active" },
  );
  assert.deepEqual(await signups.expireTrials.handler(ctx, {}), { expired: 1 });
  assert.equal(tables.clients[0].status, "trial_expired");
  assert.equal(tables.clients[1].status, "active");
  assert.equal(record.notifications[0].title, "Your Sentinel trial has ended");
});

test("wiring: paying upgrades a trial, expired trials stay readable, /signup is public", () => {
  const billing = read("backend/convex/billing.ts");
  assert.match(billing, /client\?\.plan === "trial"[\s\S]{0,200}plan: "starter"/);
  assert.match(billing, /requireClientRole\(ctx, args\.clientId, \["client_admin", "viewer"\]\)/, "an expired trial can still pay");
  assert.match(read("backend/convex/lib/access.ts"), /client\.status !== "active" && client\.status !== "trial_expired"/);
  assert.match(read("backend/convex/apiKeys.ts"), /client\.status !== "active"/, "the API refuses expired trials");
  assert.match(read("middleware.ts"), /"\/signup"/);
  assert.match(read("backend/convex/crons.ts"), /signups\.expireTrials/);
  assert.match(read("app/access-pending/page.tsx"), /<TrialStart \/>/);
});
