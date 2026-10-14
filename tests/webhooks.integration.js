const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
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

const dispatch = loadTs("backend/convex/lib/webhookDispatch.ts");

test("endpoints get only the events, products and environment they chose", () => {
  const endpoint = { status: "active", events: ["sentinel.scan.complete"], products: ["aml"], environment: "live" };
  assert.equal(dispatch.endpointWants(endpoint, { event: "sentinel.scan.complete", product: "aml", sandbox: false }), true);
  assert.equal(dispatch.endpointWants(endpoint, { event: "sentinel.scan.complete", product: "idp", sandbox: false }), false, "product filter");
  assert.equal(dispatch.endpointWants(endpoint, { event: "sentinel.scan.complete", product: "aml", sandbox: true }), false, "live only");
  assert.equal(dispatch.endpointWants(endpoint, { event: "sentinel.monitoring.alert", product: "aml", sandbox: false }), false, "not subscribed");
  assert.equal(dispatch.endpointWants({ ...endpoint, environment: "test" }, { event: "sentinel.scan.complete", product: "aml", sandbox: false }), false);
  assert.equal(dispatch.endpointWants({ ...endpoint, products: undefined, environment: "all" }, { event: "sentinel.scan.complete", product: "kyb", sandbox: true }), true);
  assert.equal(dispatch.endpointWants({ ...endpoint, events: ["sentinel.credits.low"] }, { event: "sentinel.credits.low", product: null, sandbox: false }), true, "account events ignore product and environment");
  assert.equal(dispatch.endpointWants(endpoint, { event: "sentinel.test", product: null, sandbox: false }), true, "tests always go");
  assert.deepEqual(dispatch.DEFAULT_ENDPOINT_EVENTS, ["sentinel.scan.complete", "sentinel.monitoring.alert"], "what every webhook got before subscriptions");
});

test("custom headers can't override Sentinel's own or inject lines", () => {
  assert.deepEqual(dispatch.validateCustomHeaders([{ name: " Authorization ", value: " Bearer abc " }]), [{ name: "Authorization", value: "Bearer abc" }]);
  assert.match(dispatch.validateCustomHeaders([{ name: "X-Sentinel-Signature", value: "x" }]), /can't be overridden/);
  assert.match(dispatch.validateCustomHeaders([{ name: "Content-Type", value: "text/plain" }]), /can't be overridden/);
  assert.match(dispatch.validateCustomHeaders([{ name: "X-Token", value: "a\r\nHost: evil" }]), /one line/);
  assert.match(dispatch.validateCustomHeaders([{ name: "bad name", value: "x" }]), /valid header name/);
  assert.match(dispatch.validateCustomHeaders([{ name: "A", value: "1" }, { name: "a", value: "2" }]), /twice/);
  assert.match(dispatch.validateCustomHeaders(Array.from({ length: 6 }, (_, i) => ({ name: `H${i}`, value: "v" }))), /At most 5/);
});

test("a rotated secret signs X-Sentinel-Signature-V2-Next alongside the current one", async () => {
  const sent = [];
  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    sent.push({ url, init });
    return { ok: true, status: 204, type: "basic" };
  };
  try {
    const payload = { event: "sentinel.test", scan_id: "test_1", status: "PASS", timestamp: "2026-10-15T09:30:00.000Z", result: { test: true } };
    const result = await dispatch.deliverWebhook("https://example.com/hook", payload, "old-secret", {
      nextSecret: "new-secret",
      headers: [{ name: "Authorization", value: "Bearer t" }],
    });
    assert.equal(result.success, true);
    assert.equal(typeof result.latencyMs, "number");
    const { headers, body } = sent[0].init;
    const sign = (secret) => crypto.createHmac("sha256", secret).update(`${headers["X-Sentinel-Timestamp"]}.${body}`).digest("hex");
    assert.equal(headers["X-Sentinel-Signature-V2"], sign("old-secret"));
    assert.equal(headers["X-Sentinel-Signature-V2-Next"], sign("new-secret"));
    assert.equal(headers["X-Sentinel-Signature"], crypto.createHmac("sha256", "old-secret").update(body).digest("hex"), "legacy header unchanged");
    assert.equal(headers.Authorization, "Bearer t");
    assert.equal(sent[0].init.redirect, "manual");

    await dispatch.deliverWebhook("https://example.com/hook", payload, "only-secret");
    assert.equal(sent[1].init.headers["X-Sentinel-Signature-V2-Next"], undefined, "no next header without a rotation");

    global.fetch = async () => ({ ok: false, status: 404, type: "basic" });
    const failed = await dispatch.deliverWebhook("https://example.com/hook", payload, "s");
    assert.deepEqual([failed.success, failed.statusCode, failed.error], [false, 404, "http_404"]);
  } finally {
    global.fetch = realFetch;
  }
});

// ── Attempt bookkeeping ─────────────────────────────────────────────────────

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
      let filters = [];
      const query = {
        withIndex: (_name, build) => {
          const builder = { eq: (field, value) => ((filters = [...filters, [field, value]]), builder) };
          if (build) build(builder);
          return query;
        },
        order: () => query,
        take: async (n) => (tables[table] ?? []).filter((row) => filters.every(([field, value]) => row[field] === value)).slice(0, n),
      };
      return query;
    },
  };
}

function loadWebhooks(record) {
  return loadTs("backend/convex/webhooks.ts", {
    "./_generated/server": {
      mutation: (d) => d,
      query: (d) => d,
      internalMutation: (d) => d,
      internalQuery: (d) => d,
      internalAction: (d) => d,
    },
    "./_generated/api": { internal: { webhooks: { attemptDelivery: "attemptDelivery" } } },
    "./lib/rbac": { requireClientRole: async () => ({ userId: "u", role: "client_admin" }) },
    "./lib/crypto": { randomKeySegment: () => "rand" },
    "./lib/urlSafety": { assertSafeWebhookUrl: (url) => url },
    "./lib/clientSettings": { queueForType: (type) => type },
    "./auditLog": { recordAudit: async (_ctx, entry) => record.audits.push(entry), actorTypeForClientRole: () => "client_user" },
    "./notifications": { notify: async (_ctx, params) => record.notifications.push(params) },
  });
}

function setup(failures = 0) {
  const record = { audits: [], notifications: [], scheduled: [] };
  const tables = {
    webhookEndpoints: [{ _id: "e1", clientId: "c1", url: "https://hooks.bank.co.ke/x", secret: "s", events: ["sentinel.scan.complete"], environment: "all", status: "active", consecutiveFailures: failures, createdAt: 1, updatedAt: 1 }],
    webhookDeliveries: [
      { _id: "d1", clientId: "c1", endpointId: "e1", status: "pending", attemptCount: 0, payload: {}, createdAt: 10 },
      { _id: "d2", clientId: "c1", endpointId: "e1", status: "retrying", attemptCount: 2, payload: {}, createdAt: 5 },
    ],
  };
  const ctx = {
    db: fakeDb(tables),
    scheduler: { runAt: async (at, fn, args) => record.scheduled.push({ at, fn, args }), runAfter: async (ms, fn, args) => record.scheduled.push({ ms, fn, args }) },
  };
  return { record, tables, ctx, webhooks: loadWebhooks(record) };
}

test("a failed attempt is retried on the schedule and counted against the endpoint", async () => {
  const { tables, ctx, record, webhooks } = setup();
  await webhooks._recordAttempt.handler(ctx, { deliveryId: "d1", outcome: "attempted", success: false, statusCode: 500, error: "http_500", latencyMs: 120 });
  const delivery = tables.webhookDeliveries[0];
  assert.equal(delivery.status, "retrying");
  assert.equal(delivery.attemptCount, 1);
  assert.equal(delivery.attempts.length, 1);
  assert.equal(delivery.lastLatencyMs, 120);
  assert.equal(tables.webhookEndpoints[0].consecutiveFailures, 1);
  assert.equal(record.scheduled[0].fn, "attemptDelivery");

  await webhooks._recordAttempt.handler(ctx, { deliveryId: "d1", outcome: "attempted", success: true, statusCode: 200, latencyMs: 80 });
  assert.equal(delivery.status, "delivered");
  assert.equal(tables.webhookEndpoints[0].consecutiveFailures, 0, "a success resets the count");
});

test("the 20th failure in a row pauses the endpoint, holds its queue and alerts the team", async () => {
  const { tables, ctx, record, webhooks } = setup(19);
  await webhooks._recordAttempt.handler(ctx, { deliveryId: "d1", outcome: "attempted", success: false, statusCode: 404, error: "http_404" });
  const [endpoint] = tables.webhookEndpoints;
  assert.equal(endpoint.status, "paused");
  assert.match(endpoint.pausedReason, /after 20 failed attempts in a row \(last: HTTP 404\)/);
  assert.equal(tables.webhookDeliveries[0].status, "paused");
  assert.equal(tables.webhookDeliveries[1].status, "paused", "queued deliveries are held");
  assert.equal(record.notifications[0].event, "webhook_failing");
  assert.equal(record.audits.at(-1).action, "webhook.endpoint_auto_paused");
  assert.equal(record.scheduled.length, 0, "no more retries while paused");
});

test("test events are sent once and never pause an endpoint", async () => {
  const { tables, ctx, webhooks } = setup(19);
  tables.webhookDeliveries[0].test = true;
  await webhooks._recordAttempt.handler(ctx, { deliveryId: "d1", outcome: "attempted", success: false, error: "timeout" });
  assert.equal(tables.webhookDeliveries[0].status, "failed");
  assert.equal(tables.webhookEndpoints[0].status, "active");
  assert.equal(tables.webhookEndpoints[0].consecutiveFailures, 19);
});

test("a rotated secret past its 24 hours becomes the secret", async () => {
  const { tables, ctx, webhooks } = setup();
  Object.assign(tables.webhookEndpoints[0], { nextSecret: "n", nextSecretCreatedAt: Date.now() - 25 * 3600_000 });
  await webhooks._recordAttempt.handler(ctx, { deliveryId: "d1", outcome: "attempted", success: true, statusCode: 200 });
  assert.equal(tables.webhookEndpoints[0].secret, "n");
  assert.equal(tables.webhookEndpoints[0].nextSecret, undefined);
});

test("resuming sends the held deliveries, oldest first", async () => {
  const { tables, ctx, record, webhooks } = setup();
  tables.webhookEndpoints[0].status = "paused";
  for (const row of tables.webhookDeliveries) row.status = "paused";
  const result = await webhooks.resumeEndpoint.handler({ ...ctx, auth: {} }, { endpointId: "e1" });
  assert.deepEqual(result, { requeued: 2 });
  assert.equal(tables.webhookEndpoints[0].status, "active");
  assert.deepEqual(record.scheduled.map((item) => item.args.deliveryId), ["d2", "d1"]);
  assert.ok(tables.webhookDeliveries.every((row) => row.status === "pending"));
});

test("a legacy single webhook moves into an endpoint with the same URL, secret and events", async () => {
  const record = { audits: [], notifications: [], scheduled: [] };
  const tables = { clients: [{ _id: "c1", webhookUrl: "https://a.example/x", webhookSecret: "legacy", webhookEvents: ["sentinel.scan.complete"] }], webhookEndpoints: [] };
  const webhooks = loadWebhooks(record);
  const endpoints = await webhooks.ensureEndpointsFor({ db: fakeDb(tables) }, "c1");
  assert.equal(endpoints.length, 1);
  assert.deepEqual([endpoints[0].url, endpoints[0].secret, endpoints[0].environment], ["https://a.example/x", "legacy", "all"]);
  assert.deepEqual(endpoints[0].events, ["sentinel.scan.complete"]);
  assert.equal(tables.clients[0].webhookUrl, undefined);
  assert.equal(tables.clients[0].webhookSecret, undefined);
});

test("wiring: review decisions, low credits and the Back Office use the new deliveries", () => {
  assert.match(read("backend/convex/reviewQueue.ts"), /internal\.webhooks\.dispatchWebhook, \{\s*verificationId: verification\._id,\s*reviewDecided: true,/);
  assert.match(read("backend/convex/notifications.ts"), /await queueClientEvent\(ctx, clientId, \{\s*event: "sentinel\.credits\.low"/);
  assert.match(read("backend/convex/backOfficeHealth.ts"), /row\.verificationId \? \(await ctx\.db\.get\(row\.verificationId\)\)/);
  const webhooks = read("backend/convex/webhooks.ts");
  assert.match(webhooks, /const MANAGER_ROLES: ClientRole\[\] = \["client_admin", "developer"\];/);
  assert.match(webhooks, /if \(delivery\.status === "pending" \|\| delivery\.status === "retrying"\) \{/, "no second retry chain");
  assert.match(read("backend/convex/lib/webhookDispatch.ts"), /The response body is never read/);
});
