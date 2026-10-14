const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// Transpiles a TS module to CommonJS. Relative imports come from `stubs`
// when given, otherwise they are loaded (and transpiled) for real.
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

const settings = loadTs("backend/convex/lib/clientSettings.ts");
const { DEFAULTS, resolveSettings } = settings;

// ── Defaults ────────────────────────────────────────────────────────────────

test("a client without settings keeps Sentinel's standard behaviour", () => {
  const resolved = resolveSettings(null);
  assert.equal(resolved.screening.matchThreshold, 70, "the providers' own cut-off");
  assert.equal(resolved.screening.aiGeneratedAction, "reject");
  assert.equal(resolved.screening.documentFraudAction, "reject");
  assert.equal(resolved.screening.poaMaxAgeDays, 90);
  assert.equal(resolved.screening.monitoringDefault, false);
  assert.equal(resolved.screening.adverseMediaCategories, null);
  assert.equal(resolved.review.assignment, "manual");
  assert.equal(resolved.security.requireMfa, false);
  assert.deepEqual(resolved.security.ipAllowlist, []);
  assert.equal(resolved.data.retentionMonths, 84, "POCAMLA: at least seven years");
});

test("stored settings merge onto the defaults field by field", () => {
  const resolved = resolveSettings({
    review: { clearance: { pep: "client_admin" }, deadlinesHours: { high: 4 } },
    notifications: { events: { low_credit: { email: false } } },
  });
  assert.equal(resolved.review.clearance.pep, "client_admin");
  assert.equal(resolved.review.clearance.sanctions, "client_admin");
  assert.equal(resolved.review.clearance.standard, "compliance_analyst");
  assert.deepEqual(resolved.review.deadlinesHours, { high: 4, normal: 72, low: 72 });
  assert.equal(resolved.notifications.events.low_credit.email, false);
  assert.equal(resolved.notifications.events.low_credit.enabled, true);
  assert.deepEqual(resolved.notifications.events.low_credit.roles, ["client_admin"]);
  assert.deepEqual(resolved.review.approveReasons, DEFAULTS.review.approveReasons);
});

// ── Review workflow ─────────────────────────────────────────────────────────

const rules = DEFAULTS.review;
const analyst = { userId: "u-analyst", role: "compliance_analyst" };
const reviewer = { userId: "u-reviewer", role: "reviewer" };
const admin = { userId: "u-admin", role: "client_admin" };

test("four-eyes: the first decision on a PEP case is only a recommendation", () => {
  const first = settings.checkDecision({ actor: reviewer, category: "pep", rules, makerId: null, recommendation: null });
  assert.deepEqual(first, { ok: true, final: false });
  const second = settings.checkDecision({ actor: admin, category: "pep", rules, makerId: null, recommendation: { by: reviewer.userId } });
  assert.deepEqual(second, { ok: true, final: true });
  const self = settings.checkDecision({ actor: reviewer, category: "pep", rules, makerId: null, recommendation: { by: reviewer.userId } });
  assert.equal(self.ok, false, "the recommender can't approve their own recommendation");
});

test("clearance: an analyst recommends on cases above their level and decides standard ones", () => {
  assert.deepEqual(settings.checkDecision({ actor: analyst, category: "standard", rules, makerId: null, recommendation: null }), { ok: true, final: true });
  assert.deepEqual(settings.checkDecision({ actor: analyst, category: "adverse_media", rules, makerId: null, recommendation: null }), { ok: true, final: false });
  const approve = settings.checkDecision({ actor: analyst, category: "sanctions", rules, makerId: null, recommendation: { by: reviewer.userId } });
  assert.equal(approve.ok, false, "only an Admin can approve a sanctions case");
  const byReviewer = settings.checkDecision({ actor: reviewer, category: "sanctions", rules, makerId: null, recommendation: { by: analyst.userId } });
  assert.equal(byReviewer.ok, false);
  assert.deepEqual(settings.checkDecision({ actor: admin, category: "sanctions", rules, makerId: null, recommendation: { by: analyst.userId } }), { ok: true, final: true });
});

test("maker-checker: whoever ran the check can't make the final decision", () => {
  assert.deepEqual(settings.checkDecision({ actor: admin, category: "standard", rules, makerId: admin.userId, recommendation: null }), { ok: true, final: false });
  const approve = settings.checkDecision({ actor: admin, category: "standard", rules, makerId: admin.userId, recommendation: { by: analyst.userId } });
  assert.equal(approve.ok, false);
  const off = { ...rules, makerChecker: false };
  assert.deepEqual(settings.checkDecision({ actor: admin, category: "standard", rules: off, makerId: admin.userId, recommendation: null }), { ok: true, final: true });
});

test("developers and viewers never decide; DeepTrack admins rank as Admins", () => {
  for (const role of ["developer", "viewer"]) {
    assert.equal(settings.checkDecision({ actor: { userId: "x", role }, category: "standard", rules, makerId: null, recommendation: null }).ok, false);
  }
  assert.deepEqual(settings.checkDecision({ actor: { userId: "dt", role: "internal_admin" }, category: "sanctions", rules, makerId: null, recommendation: { by: "u" } }), { ok: true, final: true });
});

test("case category follows the most serious hit or flag", () => {
  const base = { type: "aml", priority: "normal", documentFlags: [] };
  assert.equal(settings.caseCategoryFor({ ...base, flagged: [{ source: "OPENSANCTIONS", categories: ["pep", "sanctions"] }] }), "sanctions");
  assert.equal(settings.caseCategoryFor({ ...base, flagged: [{ source: "OPENSANCTIONS", categories: ["pep"], pepClass: 2 }] }), "pep");
  assert.equal(settings.caseCategoryFor({ ...base, flagged: [{ source: "ADVERSE_MEDIA" }] }), "adverse_media");
  assert.equal(settings.caseCategoryFor({ ...base, flagged: [{ source: "OFAC_SDN" }] }), "sanctions", "older rows without categories are sanctions hits");
  assert.equal(settings.caseCategoryFor({ type: "document", priority: "high", flagged: [], documentFlags: [{ code: "visual_ai_generated", severity: "critical" }] }), "document_fraud");
  assert.equal(settings.caseCategoryFor({ type: "kyb", priority: "high", flagged: [], documentFlags: [] }), "high_risk");
  assert.equal(settings.caseCategoryFor({ type: "kyb", priority: "normal", flagged: [], documentFlags: [] }), "standard");
});

test("a PEP in a high-risk class raises the case to high priority", () => {
  const screening = DEFAULTS.screening;
  assert.equal(settings.priorityFor("normal", [{ source: "OPENSANCTIONS", pepClass: 1 }], screening), "high");
  assert.equal(settings.priorityFor("normal", [{ source: "OPENSANCTIONS", pepClass: 4 }], screening), "normal");
  assert.equal(settings.priorityFor("normal", [{ source: "OPENSANCTIONS", pepClass: 4 }], { ...screening, highRiskPepClasses: [4] }), "high");
});

test("review deadlines come from the client's hours per priority", () => {
  const at = Date.UTC(2026, 9, 15, 9, 30);
  assert.equal(settings.deadlineFor(at, "high", rules), at + 24 * 3600_000);
  assert.equal(settings.deadlineFor(at, "normal", { ...rules, deadlinesHours: { high: 4, normal: 8, low: 72 } }), at + 8 * 3600_000);
});

// ── Validation ──────────────────────────────────────────────────────────────

test("settings are validated before they are saved", () => {
  assert.throws(() => settings.validateScreeningSettings({ matchThreshold: 60 }, { adverseMedia: ["fraud"], poaDocuments: ["water_bill"] }), /70 to 95/);
  assert.throws(() => settings.validateScreeningSettings({ adverseMediaCategories: [] }, { adverseMedia: ["fraud"], poaDocuments: [] }), /at least one adverse media/);
  assert.throws(() => settings.validateScreeningSettings({ acceptedPoaDocuments: ["other"] }, { adverseMedia: [], poaDocuments: ["other", "water_bill"] }), /Unknown proof of address/);
  assert.throws(() => settings.validateDataSettings({ retentionMonths: 24 }), /84 to 240/);
  assert.throws(() => settings.validateReviewSettings({ deadlinesHours: { high: 0 } }), /1 to 720/);
  assert.throws(() => settings.validateReviewSettings({ requireReasonCode: true, approveReasons: ["  "] }), /at least one approve and one reject reason/);
  assert.throws(() => settings.validateSecuritySettings({ allowedEmailDomains: ["not a domain"] }), /not a valid email domain/);
  assert.throws(() => settings.validateSecuritySettings({ ipAllowlist: ["10.0.0.0/33"] }), /CIDR/);
  assert.throws(() => settings.validateSecuritySettings({ ipAllowlistApi: true, ipAllowlist: [] }), /at least one IP range/);
  assert.throws(() => settings.validateSecuritySettings({ sessionTimeoutMinutes: 2 }), /5 to 720/);
  assert.deepEqual(settings.validateSecuritySettings({ allowedEmailDomains: ["@KCB.co.ke", "kcb.co.ke"] }).allowedEmailDomains, ["kcb.co.ke"]);
  assert.throws(() => settings.validateProfileSettings({ complianceContactEmail: "nope" }), /not valid/);
  assert.deepEqual(settings.validateProfileSettings({ legalName: "  Bank  ", regulator: "CBK", regulatorOther: "x" }), { legalName: "Bank", regulator: "CBK" });
});

// ── Email domains and IP allowlist ──────────────────────────────────────────

test("invites are limited to the allowed email domains, subdomains included", () => {
  assert.equal(settings.emailAllowed("cro@kcb.co.ke", []), true);
  assert.equal(settings.emailAllowed("cro@kcb.co.ke", ["kcb.co.ke"]), true);
  assert.equal(settings.emailAllowed("ops@ke.kcb.co.ke", ["kcb.co.ke"]), true);
  assert.equal(settings.emailAllowed("cro@notkcb.co.ke", ["kcb.co.ke"]), false);
  assert.equal(settings.emailAllowed("cro@gmail.com", ["kcb.co.ke"]), false);
});

test("the IP allowlist matches IPv4 and IPv6 addresses and CIDR ranges", () => {
  assert.equal(settings.ipAllowed("1.2.3.4", []), true, "no rules = any network");
  assert.equal(settings.ipAllowed("196.201.214.77", ["196.201.214.0/24"]), true);
  assert.equal(settings.ipAllowed("196.201.215.1", ["196.201.214.0/24"]), false);
  assert.equal(settings.ipAllowed("41.90.1.1", ["41.90.1.1"]), true);
  assert.equal(settings.ipAllowed("41.90.1.2", ["41.90.1.1"]), false);
  assert.equal(settings.ipAllowed("::ffff:196.201.214.9", ["196.201.214.0/24"]), true, "IPv4-mapped IPv6");
  assert.equal(settings.ipAllowed("2001:db8::1", ["2001:db8::/32"]), true);
  assert.equal(settings.ipAllowed("2001:db9::1", ["2001:db8::/32"]), false);
  assert.equal(settings.ipAllowed(null, ["10.0.0.0/8"]), false, "an unknown address is refused");
  assert.equal(settings.ipAllowed("10.1.2.3", ["0.0.0.0/0"]), true);
  assert.equal(settings.parseIpRule("300.1.1.1"), null);
  assert.equal(settings.parseIpRule("1:2:3"), null);
});

// ── Document and screening rules ────────────────────────────────────────────

test("IDP rules can send AI-generated or fraud rejections to review", () => {
  const screening = DEFAULTS.screening;
  const ai = { flags: [{ code: "visual_ai_generated", severity: "critical" }], documentKind: "identity" };
  const expired = { flags: [{ code: "document_expired", severity: "critical" }], documentKind: "identity" };
  const both = { flags: [...ai.flags, ...expired.flags], documentKind: "identity" };
  assert.equal(settings.applyDocumentRules("reject", ai, screening).verdict, "reject", "default: AI-generated rejects");
  assert.equal(settings.applyDocumentRules("reject", ai, { ...screening, aiGeneratedAction: "review" }).verdict, "review");
  assert.equal(settings.applyDocumentRules("reject", expired, { ...screening, aiGeneratedAction: "review" }).verdict, "reject", "other fraud still rejects");
  assert.equal(settings.applyDocumentRules("reject", both, { ...screening, aiGeneratedAction: "review" }).verdict, "reject", "every reason must be one sent to review");
  assert.equal(settings.applyDocumentRules("reject", both, { ...screening, aiGeneratedAction: "review", documentFraudAction: "review" }).verdict, "review");
  assert.equal(settings.applyDocumentRules("pass", ai, { ...screening, aiGeneratedAction: "review" }).verdict, "pass");
});

test("a proof of address type the client doesn't accept can't pass", () => {
  const screening = { ...DEFAULTS.screening, acceptedPoaDocuments: ["bank_statement", "electricity_bill"] };
  const poa = (documentType) => ({ flags: [], documentKind: "proof_of_address", proofOfAddress: { fields: { documentType } } });
  assert.equal(settings.applyDocumentRules("pass", poa("bank_statement"), screening).verdict, "pass");
  const outcome = settings.applyDocumentRules("pass", poa("rental_agreement"), screening);
  assert.equal(outcome.verdict, "review");
  assert.match(outcome.notes[0], /rental agreement is not on your organization's accepted proof of address list/);
  assert.equal(settings.applyDocumentRules("pass", poa("rental_agreement"), DEFAULTS.screening).verdict, "pass", "null = every type");
});

test("monitoring frequency and the low-credit warning level", () => {
  const day = 24 * 3600_000;
  assert.equal(settings.monitoringIntervalMs("daily"), day);
  assert.equal(settings.monitoringIntervalMs("weekly"), 7 * day);
  assert.equal(settings.monitoringIntervalMs("monthly"), 30 * day);
  assert.equal(settings.lowCreditLevel({ creditLimit: 6250, creditThresholdPct: 80 }, { lowCreditBalance: null }), 1250);
  assert.equal(settings.lowCreditLevel({ creditLimit: 6250, creditThresholdPct: 80 }, { lowCreditBalance: 500 }), 500);
});

test("AML screening applies the client's threshold and adverse media categories", () => {
  const aml = read("backend/convex/aml.ts");
  assert.match(aml, /candidate\.nameScore >= threshold &&/);
  assert.match(aml, /Math\.round\(match\.score \* 100\) >= threshold &&/);
  assert.match(aml, /\(!categories \|\| hit\.riskTypes\.some\(\(type\) => categories\.includes\(type\)\)\) &&/);
  assert.match(aml, /const ruled = applyScreeningRules\(candidates\[index\], openSanctionsOutcomes\[index\], adverseMediaOutcomes\[index\], rules\?\.\[index\]\);/);
  assert.match(aml, /const rules: ScreeningRules\[\] = await ctx\.runQuery\(internalApi\.aml\._screeningRules, \{ clientIds: \[clientId\], subjectKeys: \[subjectKey\] \}\);/);
});

// ── Team ────────────────────────────────────────────────────────────────────

// A small in-memory stand-in for ctx.db: withIndex conditions are applied
// as field equality filters.
function fakeDb(tables) {
  let next = 1;
  const rowsOf = (table) => (tables[table] ??= []);
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
      rowsOf(table).push({ _id, _creationTime: Date.now(), ...row });
      return _id;
    },
    patch: async (id, changes) => {
      const row = find(id);
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) delete row[key];
        else row[key] = value;
      }
    },
    delete: async (id) => {
      for (const rows of Object.values(tables)) {
        const index = rows.findIndex((item) => item._id === id);
        if (index >= 0) rows.splice(index, 1);
      }
    },
    query: (table) => {
      let filters = [];
      const query = {
        withIndex: (_name, build) => {
          const builder = { eq: (field, value) => ((filters = [...filters, [field, value]]), builder) };
          if (build) build(builder);
          return query;
        },
        order: () => query,
        filter: () => query,
        rows: () => rowsOf(table).filter((row) => filters.every(([field, value]) => row[field] === value)),
        take: async (n) => query.rows().slice(0, n),
        unique: async () => query.rows()[0] ?? null,
        first: async () => query.rows()[0] ?? null,
      };
      return query;
    },
  };
}

function loadTeam(audits) {
  return loadTs("backend/convex/team.ts", {
    "./_generated/server": { mutation: (definition) => definition, query: (definition) => definition },
    "./lib/rbac": {
      requireClientRole: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        return { userId: identity.subject, role: "client_admin" };
      },
    },
    "./auditLog": { recordAudit: async (_ctx, entry) => audits.push(entry), actorTypeForClientRole: () => "client_user" },
    "./reviewQueue": { displayName: (identity) => identity?.name },
    "./lib/clientSettings": settings,
  });
}

test("an invite is accepted only by a signed-in user with that verified email", async () => {
  const audits = [];
  const team = loadTeam(audits);
  const now = Date.now();
  const tables = {
    clients: [{ _id: "c1", status: "active", name: "Example Bank" }],
    teamInvites: [{ _id: "i1", clientId: "c1", email: "cro@bank.co.ke", role: "client_admin", status: "pending", invitedBy: "dt", createdAt: now, expiresAt: now + 86_400_000 }],
    clientMembers: [],
    clientSettings: [],
  };
  const db = fakeDb(tables);
  const ctxFor = (identity) => ({ db, auth: { getUserIdentity: async () => identity } });

  assert.deepEqual(await team.acceptMyInvites.handler(ctxFor({ subject: "auth0|x", email: "cro@bank.co.ke", emailVerified: false }), {}), { accepted: 0 });
  assert.deepEqual(await team.acceptMyInvites.handler(ctxFor({ subject: "auth0|y", email: "other@bank.co.ke", emailVerified: true }), {}), { accepted: 0 });
  assert.equal(tables.clientMembers.length, 0);

  assert.deepEqual(await team.acceptMyInvites.handler(ctxFor({ subject: "auth0|cro", email: "CRO@bank.co.ke", emailVerified: true }), {}), { accepted: 1 });
  assert.equal(tables.clientMembers.length, 1);
  assert.equal(tables.clientMembers[0].userId, "auth0|cro");
  assert.equal(tables.clientMembers[0].role, "client_admin");
  assert.equal(tables.teamInvites[0].status, "accepted");
  assert.equal(audits.at(-1).action, "team.invite_accepted");
  assert.deepEqual(await team.acceptMyInvites.handler(ctxFor({ subject: "auth0|cro", email: "cro@bank.co.ke", emailVerified: true }), {}), { accepted: 0 }, "used once");
});

test("expired invites and inactive clients don't grant access", async () => {
  const team = loadTeam([]);
  const now = Date.now();
  const tables = {
    clients: [{ _id: "c1", status: "active" }, { _id: "c2", status: "suspended" }],
    teamInvites: [
      { _id: "i1", clientId: "c1", email: "a@bank.co.ke", role: "viewer", status: "pending", invitedBy: "x", createdAt: now - 9e8, expiresAt: now - 1 },
      { _id: "i2", clientId: "c2", email: "a@bank.co.ke", role: "viewer", status: "pending", invitedBy: "x", createdAt: now, expiresAt: now + 1e6 },
    ],
    clientMembers: [],
    clientSettings: [],
  };
  const db = fakeDb(tables);
  const result = await team.acceptMyInvites.handler({ db, auth: { getUserIdentity: async () => ({ subject: "s", email: "a@bank.co.ke", emailVerified: true }) } }, {});
  assert.deepEqual(result, { accepted: 0 });
  assert.equal(tables.clientMembers.length, 0);
});

test("the seat limit counts active members and pending invites", async () => {
  const team = loadTeam([]);
  const now = Date.now();
  const tables = {
    clients: [{ _id: "c1", status: "active", seatLimit: 2 }],
    clientMembers: [
      { _id: "m1", clientId: "c1", userId: "a", role: "client_admin", isActive: true, createdAt: 1 },
      { _id: "m2", clientId: "c1", userId: "b", role: "viewer", isActive: false, createdAt: 2 },
    ],
    teamInvites: [{ _id: "i1", clientId: "c1", email: "x@y.co", role: "viewer", status: "pending", invitedBy: "a", createdAt: now, expiresAt: now + 1e6 }],
    userProfiles: [],
    clientSettings: [],
  };
  const db = fakeDb(tables);
  assert.deepEqual(await team.seatUsage({ db }, "c1", now), { used: 2, active: 1, pending: 1, limit: 2 });
  const ctx = { db, auth: { getUserIdentity: async () => ({ subject: "a", name: "Admin" }) } };
  await assert.rejects(team.createInvite.handler(ctx, { clientId: "c1", email: "new@y.co", role: "viewer" }), /All 2 seats/);
});

test("a team keeps at least one active Admin, and nobody deactivates themselves", async () => {
  const team = loadTeam([]);
  const tables = {
    clients: [{ _id: "c1", status: "active" }],
    clientMembers: [{ _id: "m1", clientId: "c1", userId: "a", role: "client_admin", isActive: true, createdAt: 1 }],
    reviewQueue: [],
  };
  const db = fakeDb(tables);
  const ctx = { db, auth: { getUserIdentity: async () => ({ subject: "dt-admin" }) } };
  await assert.rejects(team.changeRole.handler(ctx, { membershipId: "m1", role: "reviewer" }), /at least one active Admin/);
  await assert.rejects(team.deactivate.handler(ctx, { membershipId: "m1" }), /at least one active Admin/);
  const self = { db, auth: { getUserIdentity: async () => ({ subject: "a" }) } };
  await assert.rejects(team.deactivate.handler(self, { membershipId: "m1" }), /can't deactivate yourself/);
});

test("team, invites and settings are Admin-only and audited", () => {
  const team = read("backend/convex/team.ts");
  assert.match(team, /async function requireAdmin\(ctx: MutationCtx \| QueryCtx, clientId: Id<"clients">\) \{\s*return await requireClientRole\(ctx, clientId, \["client_admin"\]\);/);
  for (const action of ["team.invite_created", "team.invite_revoked", "team.invite_accepted", "team.role_changed", "team.member_deactivated", "team.member_removed"]) {
    assert.match(team, new RegExp(`"${action.replace(".", "\\.")}"`));
  }
  assert.match(team, /identity\.emailVerified !== true/);
  const org = read("backend/convex/orgSettings.ts");
  assert.match(org, /const actor = await requireClientRole\(ctx, clientId, \["client_admin"\]\);/);
  assert.match(org, /action: `settings\.\$\{section\}_updated`/);
  assert.match(org, /saving it would lock you out/);
  // The Auth0 email goes out only after Convex accepted the invite.
  const actions = read("app/(platform)/settings/team/actions.ts");
  assert.ok(actions.indexOf("anyApi.team.createInvite") < actions.indexOf("sendOrganizationInvitation({"), "Convex authorizes before Auth0 sends");
});

// ── Wiring ──────────────────────────────────────────────────────────────────

test("every review case is queued under the client's rules", () => {
  for (const file of ["backend/convex/verifications.ts", "backend/convex/amlPersistence.ts", "backend/convex/documents.ts"]) {
    const source = read(file);
    assert.match(source, /await queueReview\(ctx, \{/, file);
    assert.doesNotMatch(source, /ctx\.db\.insert\("reviewQueue"/, `${file} inserts review items through queueReview`);
  }
  const reviews = read("backend/convex/clientReviews.ts");
  assert.match(reviews, /const check = checkDecision\(\{ actor, category, rules, makerId, recommendation: row\.recommendation \?\? null \}\);\s*if \(!check\.ok\) forbidden\(check\.reason\);/);
  assert.match(reviews, /client: \{\s*actorType:/, "client decisions resolve through resolveReviewItem's client path");
  assert.match(read("backend/convex/crons.ts"), /crons\.interval\("flag overdue client reviews", \{ minutes: 15 \}, internal\.clientReviews\.flagOverdue/);
  const queue = read("backend/convex/reviewQueue.ts");
  assert.match(queue, /const label = client \? null : feedbackLabelFor\(verification\.verdict, finalVerdict\);/, "client decisions aren't training labels");
  assert.match(queue, /!client &&\s*\(action === "confirm" \|\| action === "keep_verdict"\)/, "the 80% certainty rule stays for DeepTrack reviewers");
});

test("API keys: scopes, rotation grace and the API IP allowlist are enforced", () => {
  const keys = read("backend/convex/apiKeys.ts");
  assert.match(keys, /if \(!keyRow \|\| !keyIsUsable\(keyRow\)\) \{/);
  assert.match(keys, /const KEY_MANAGER_ROLES = \["client_admin", "developer"\] as const;/);
  assert.match(keys, /export const ROTATION_GRACE_MS = 24 \* 60 \* 60 \* 1000;/);
  const http = read("backend/convex/http.ts");
  assert.match(http, /if \(!keyAllowsRoute\(auth\.scopes, route\)\) \{/);
  assert.match(http, /if \(ipRules\.length > 0 && !ipAllowed\(requestIp\(request\), ipRules\)\) \{/);
  const { keyAllowsRoute, scopeForRoute } = loadTs("backend/convex/apiKeys.ts", {
    "./_generated/server": { mutation: (d) => d, query: (d) => d, internalMutation: (d) => d, internalQuery: (d) => d },
    "./_generated/api": { internal: {} },
    "./lib/crypto": {},
    "./lib/rbac": {},
    "./lib/credits": {},
    "./auditLog": {},
    "./lib/clientSettings": settings,
  });
  assert.equal(keyAllowsRoute(null, "POST /v1/verify/aml"), true, "older keys keep every scope");
  assert.equal(keyAllowsRoute(["verify:kyc"], "POST /v1/verify/aml"), false);
  assert.equal(keyAllowsRoute(["verify:aml"], "POST /v1/verify/aml"), true);
  assert.equal(scopeForRoute("GET /v1/verify/*"), "results:read");
  assert.equal(scopeForRoute("DELETE /v1/monitoring/subjects/*"), "monitoring");
  assert.equal(scopeForRoute("GET /v1/credits/ledger"), "credits:read");
});

test("the portal enforces MFA, the IP allowlist and the idle timeout", () => {
  const layout = read("app/(platform)/layout.tsx");
  assert.match(layout, /anyApi\.team\.acceptMyInvites/);
  assert.match(layout, /if \(!ipAllowed\(ip, gate\.ipAllowlist\)\)/);
  assert.match(layout, /if \(active && gate\.requireMfa && !\(await sessionUsedMfa\(\)\)\)/);
  assert.match(layout, /<IdleTimeout minutes=\{gate\.sessionTimeoutMinutes\} \/>/);
  assert.match(read("auth0/sentinel-role-claims-action.js"), /api\.multifactor\.enable\("any"/);
  assert.match(read("backend/lib/auth.ts"), /export async function sessionUsedMfa\(\)/);
});

test("each Settings tab has a page", () => {
  const nav = read("app/(platform)/settings/settings-nav.tsx");
  const urls = [...nav.matchAll(/href: "([^"]+)"/g)].map((match) => match[1]);
  assert.equal(urls.length, 9);
  for (const url of urls) {
    assert.ok(fs.existsSync(path.join(root, "app", "(platform)", ...url.slice(1).split("/"), "page.tsx")), `${url} has a page`);
  }
  assert.ok(fs.existsSync(path.join(root, "app", "(platform)", "reviews", "[id]", "page.tsx")));
  assert.match(read("components/app-sidebar.tsx"), /\{ title: "Reviews", url: "\/reviews", icon: ClipboardCheck \}/);
});
