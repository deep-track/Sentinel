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

const invoices = loadTs("backend/convex/lib/invoices.ts");
const paystack = loadTs("backend/convex/lib/paystack.ts");

// ── Invoice arithmetic ──────────────────────────────────────────────────────

test("invoice totals, numbers and top-up quotes", () => {
  assert.deepEqual(invoices.invoiceTotals([{ description: "x", quantity: 1, unitPrice: 1000, amount: 1000 }], 16), { subtotal: 1000, vat: 160, total: 1160 });
  assert.deepEqual(invoices.invoiceTotals([{ description: "x", quantity: 1, unitPrice: 99.99, amount: 99.99 }], 0), { subtotal: 99.99, vat: 0, total: 99.99 });
  assert.equal(invoices.invoiceNumber(2026, 7), "DT-2026-0007");

  const kes = invoices.topUpQuote(4_010, "KES", "starter");
  assert.equal(kes.amount, 4_000, "KES rounds down to whole credits");
  assert.equal(kes.credits, 100, "KES 40 per credit");
  assert.equal(invoices.topUpQuote(4_000, "KES", "enterprise").credits, 120, "the plan bonus applies to top-ups");
  assert.equal(invoices.topUpQuote(100, "USD", "starter").credits, 10_000, "1 credit = 1 US cent");
  assert.match(invoices.topUpQuote(500, "KES", "starter").error, /1,000/);
  assert.match(invoices.topUpQuote(NaN, "USD", "starter").error, /Top-ups/);
  assert.equal(invoices.toSubunits(1160.5), 116050);
  assert.equal(invoices.cleanEmail(" Finance@Bank.co.ke "), "finance@bank.co.ke");
  assert.equal(invoices.cleanEmail("nope"), null);
});

// ── Paystack ────────────────────────────────────────────────────────────────

test("Paystack webhook signatures are HMAC-SHA512 of the raw body", async () => {
  const body = JSON.stringify({ event: "charge.success", data: { reference: "snt-abc" } });
  const good = crypto.createHmac("sha512", "sk_test_x").update(body).digest("hex");
  assert.equal(await paystack.validPaystackSignature(body, good, "sk_test_x"), true);
  assert.equal(await paystack.validPaystackSignature(body, good, "sk_test_other"), false);
  assert.equal(await paystack.validPaystackSignature(`${body} `, good, "sk_test_x"), false);
  assert.equal(await paystack.validPaystackSignature(body, null, "sk_test_x"), false);
  assert.equal(await paystack.validPaystackSignature(body, "abc", "sk_test_x"), false);
});

test("a payment counts only if Paystack says success for exactly the invoiced amount", () => {
  const expected = { reference: "snt-1", amount: 400000, currency: "KES" };
  assert.equal(paystack.paymentMatches({ status: "success", reference: "snt-1", amount: 400000, currency: "KES" }, expected), true);
  assert.equal(paystack.paymentMatches({ status: "success", reference: "snt-1", amount: 100, currency: "KES" }, expected), false);
  assert.equal(paystack.paymentMatches({ status: "success", reference: "snt-1", amount: 400000, currency: "USD" }, expected), false);
  assert.equal(paystack.paymentMatches({ status: "abandoned", reference: "snt-1", amount: 400000, currency: "KES" }, expected), false);
  assert.match(paystack.paymentReference("a1b2"), /^snt-a1b2$/);
  assert.equal(/^[A-Za-z0-9.=-]+$/.test(paystack.paymentReference("x_y")), true, "only characters Paystack allows");
});

test("Paystack requests: initialize in subunits with the callback, verify by reference", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ status: true, data: { authorization_url: "https://checkout.paystack.com/x", access_code: "a", reference: "snt-1", status: "success" } }) };
  };
  const session = await paystack.initializeTransaction("sk", { email: "f@b.co", amount: 400000, currency: "KES", reference: "snt-1", callbackUrl: "https://app/billing?payment=snt-1", metadata: { invoice: "DT-2026-0001" } }, fetchImpl);
  assert.equal(session.authorization_url, "https://checkout.paystack.com/x");
  assert.equal(calls[0].url, "https://api.paystack.co/transaction/initialize");
  assert.equal(calls[0].init.headers.Authorization, "Bearer sk");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.amount, "400000");
  assert.equal(body.callback_url, "https://app/billing?payment=snt-1");
  assert.equal(typeof body.metadata, "string", "metadata is stringified JSON");
  await paystack.verifyTransaction("sk", "snt-1", fetchImpl);
  assert.equal(calls[1].url, "https://api.paystack.co/transaction/verify/snt-1");
  await assert.rejects(paystack.verifyTransaction("sk", "x", async () => ({ ok: false, status: 401, json: async () => ({ status: false, message: "Invalid key" }) })), /Invalid key/);
});

// ── Settling payments, on a fake database ───────────────────────────────────

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
      const query = {
        withIndex: (_name, build) => {
          const builder = { eq: (field, value) => (filters.push((row) => row[field] === value), builder) };
          if (build) build(builder);
          return query;
        },
        order: () => query,
        take: async (n) => (tables[table] ?? []).filter((row) => filters.every((check) => check(row))).slice(0, n),
        first: async () => (tables[table] ?? []).find((row) => filters.every((check) => check(row))) ?? null,
        unique: async () => (tables[table] ?? []).find((row) => filters.every((check) => check(row))) ?? null,
      };
      return query;
    },
  };
}

function setup() {
  const record = { ledger: [], audits: [], notifications: [] };
  const billing = loadTs("backend/convex/billing.ts", {
    "./_generated/server": { action: (d) => d, internalAction: (d) => d, internalMutation: (d) => d, internalQuery: (d) => d, mutation: (d) => d, query: (d) => d },
    "./_generated/api": { internal: {} },
    "./lib/rbac": { requireClientRole: async () => ({ userId: "admin", role: "client_admin" }), requireInternalAdmin: async () => "ops", requireInternalUser: async () => "ops" },
    "./lib/credits": { recordLedgerEntry: async (_ctx, entry) => record.ledger.push(entry) },
    "./lib/clientSettings": { loadClientSettings: async () => ({ profile: { legalName: "Acme Bank PLC" } }) },
    "./auditLog": { recordAudit: async (_ctx, entry) => record.audits.push(entry), actorTypeForClientRole: () => "client_user" },
    "./notifications": { notify: async (_ctx, params) => record.notifications.push(params) },
  });
  const tables = {
    clients: [{ _id: "c1", name: "Acme", plan: "starter", status: "active", billingCurrency: "KES" }],
    billingSettings: [],
    clientBilling: [],
    invoices: [],
    payments: [],
  };
  const ctx = { db: fakeDb(tables), auth: { getUserIdentity: async () => ({ email: "cro@acme.co.ke" }) } };
  return { billing, ctx, tables, record };
}

const success = (reference, amount, extra = {}) => ({
  status: "success",
  reference,
  amount,
  currency: "KES",
  channel: "card",
  authorization: { authorization_code: "AUTH_x", reusable: true, last4: "4081", brand: "visa", exp_month: "12", exp_year: "2030", channel: "card" },
  ...extra,
});

test("a top-up is invoiced, paid once on Paystack's confirmation, and can save the card", async () => {
  const { billing, ctx, tables, record } = setup();
  const started = await billing._startPayment.handler(ctx, { clientId: "c1", amount: 4_000, saveCard: true });
  assert.equal(started.amount, 400_000, "KES 4,000 in subunits");
  assert.equal(started.email, "cro@acme.co.ke");
  const invoice = tables.invoices[0];
  assert.equal(invoice.number, `DT-${new Date().getUTCFullYear()}-0001`);
  assert.equal(invoice.credits, 100);
  assert.equal(invoice.buyer.name, "Acme Bank PLC");
  assert.equal(invoice.status, "issued");

  assert.deepEqual(await billing._settle.handler(ctx, { reference: started.reference, transaction: success(started.reference, 400_000) }), { status: "paid" });
  assert.equal(invoice.status, "paid");
  assert.equal(invoice.paymentMethod, "paystack");
  assert.deepEqual(record.ledger, [{ clientId: "c1", type: "allocation", amount: 100, reason: `Invoice ${invoice.number} paid (paystack)` }]);
  assert.equal(tables.clientBilling[0].card.authorizationCode, "AUTH_x");
  assert.equal(tables.clientBilling[0].card.last4, "4081");

  // The webhook and the return from checkout both settle: credits once.
  assert.deepEqual(await billing._settle.handler(ctx, { reference: started.reference, transaction: success(started.reference, 400_000) }), { status: "already" });
  assert.equal(record.ledger.length, 1);

  const second = await billing._startPayment.handler(ctx, { clientId: "c1", amount: 1_000, saveCard: false });
  assert.match(tables.invoices[1].number, /-0002$/, "numbers follow on");
  assert.equal(second.reference === started.reference, false);
});

test("a wrong amount, a failed charge or a still-pending one adds no credits", async () => {
  const { billing, ctx, tables, record } = setup();
  const started = await billing._startPayment.handler(ctx, { clientId: "c1", amount: 4_000, saveCard: false });
  assert.deepEqual(await billing._settle.handler(ctx, { reference: started.reference, transaction: { status: "ongoing", reference: started.reference, amount: 400_000, currency: "KES" } }), { status: "pending" });
  assert.equal(tables.payments[0].status, "initialized");
  assert.deepEqual(await billing._settle.handler(ctx, { reference: started.reference, transaction: success(started.reference, 100) }), { status: "failed" });
  assert.match(tables.payments[0].failureReason, /doesn't match/);
  assert.equal(tables.invoices[0].status, "issued", "the invoice stays payable");
  assert.equal(record.ledger.length, 0);
  assert.equal(tables.clientBilling.length, 0, "no card saved without consent");
});

test("DeepTrack marks bank / M-Pesa payments; a paid invoice can't be paid or cancelled again", async () => {
  const { billing, ctx, tables, record } = setup();
  const { invoiceId } = await billing.issueInvoice.handler(ctx, { clientId: "c1", kind: "plan", plan: "growth" });
  const invoice = tables.invoices.find((row) => row._id === invoiceId);
  assert.equal(invoice.total, 550_000);
  assert.equal(invoice.credits, 15_125, "KES Growth: 550,000 / 40 + 10% bonus");
  await assert.rejects(billing.markPaid.handler(ctx, { invoiceId, method: "mpesa", reference: "" }), /reference/);
  await billing.markPaid.handler(ctx, { invoiceId, method: "mpesa", reference: "SJK2X9ABCD" });
  assert.equal(invoice.status, "paid");
  assert.equal(invoice.paymentMethod, "mpesa");
  assert.equal(record.ledger[0].amount, 15_125);
  await assert.rejects(billing.markPaid.handler(ctx, { invoiceId, method: "mpesa", reference: "again" }), /unpaid/);
  await assert.rejects(billing.voidInvoice.handler(ctx, { invoiceId, reason: "mistake" }), /unpaid/);
  await assert.rejects(billing._startPayment.handler(ctx, { clientId: "c1", invoiceId, saveCard: false }), /already paid/);
});

test("VAT from the invoice settings is added to the total, not to the credits", async () => {
  const { billing, ctx, tables } = setup();
  await billing.saveSeller.handler(ctx, { name: "DeepTrack Ltd", vatRatePct: 16, paymentInstructions: "M-Pesa Paybill 123456, Account DT" });
  await billing._startPayment.handler(ctx, { clientId: "c1", amount: 4_000, saveCard: false });
  const invoice = tables.invoices[0];
  assert.deepEqual([invoice.subtotal, invoice.vat, invoice.total, invoice.credits], [4_000, 640, 4_640, 100]);
  assert.equal(invoice.seller.paymentInstructions, "M-Pesa Paybill 123456, Account DT");
  assert.equal(tables.payments[0].amount, 464_000);
});

test("automatic top-up: only with a saved card, at the threshold, at most every 12 hours", async () => {
  const { maybeAutoTopUp } = loadTs("backend/convex/lib/autoTopUp.ts", { "../_generated/api": { internal: { billing: { autoTopUp: "autoTopUp" } } } });
  const scheduled = [];
  const tables = { clientBilling: [{ _id: "b1", clientId: "c1", autoTopUp: { enabled: true, amount: 4000, thresholdCredits: 50 }, card: { authorizationCode: "A" } }] };
  const ctx = { db: fakeDb(tables), scheduler: { runAfter: async (_ms, fn, args) => scheduled.push({ fn, args }) } };
  const now = Date.UTC(2026, 9, 15);
  assert.equal(await maybeAutoTopUp(ctx, "c1", 51, now), false, "above the threshold");
  assert.equal(await maybeAutoTopUp(ctx, "c1", 50, now), true);
  assert.deepEqual(scheduled, [{ fn: "autoTopUp", args: { clientId: "c1" } }]);
  assert.equal(await maybeAutoTopUp(ctx, "c1", 10, now + 60_000), false, "cooldown");
  assert.equal(await maybeAutoTopUp(ctx, "c1", 10, now + 13 * 3600_000), true);
  delete tables.clientBilling[0].card;
  assert.equal(await maybeAutoTopUp(ctx, "c1", 0, now + 30 * 3600_000), false, "no saved card");
});

test("wiring: the Paystack webhook verifies the signature, ledger charges trigger auto top-up", () => {
  const http = read("backend/convex/http.ts");
  assert.match(http, /path: "\/webhooks\/paystack"/);
  assert.match(http, /validPaystackSignature\(raw, request\.headers\.get\("x-paystack-signature"\), secret\)/);
  assert.match(http, /billing\.verifyAndSettle/);
  assert.match(read("backend/convex/lib/credits.ts"), /if \(entry\.amount < 0\) await maybeAutoTopUp/);
  const billingSource = read("backend/convex/billing.ts");
  assert.doesNotMatch(billingSource.slice(billingSource.indexOf("export const overview"), billingSource.indexOf("export const invoice ")), /authorizationCode/, "the card token never reaches the browser");
});

// ── Invoice PDF ─────────────────────────────────────────────────────────────

test("the invoice PDF: a receipt once paid, safe text, a stable file name", async () => {
  const pdf = loadTs("components/billing/invoice-pdf.ts");
  const { PDFDocument } = require("pdf-lib");
  const base = {
    number: "DT-2026-0001",
    currency: "KES",
    lines: [{ description: "Sentinel credits top-up (100 credits)", quantity: 1, unitPrice: 4000, amount: 4000 }],
    subtotal: 4000,
    vatRatePct: 16,
    vat: 640,
    total: 4640,
    credits: 100,
    buyer: { name: "Kampuni ya Mwangi – “SACCO” 中" },
    seller: { name: "DeepTrack Ltd", paymentInstructions: "M-Pesa: Paybill 247247, Account 0123456789" },
    issuedAt: Date.UTC(2026, 9, 15),
    dueAt: Date.UTC(2026, 9, 29),
  };
  const logo = fs.readFileSync(path.join(root, "public/deeptrack-transparent.png"));
  const paid = await pdf.buildInvoicePdf({ ...base, status: "paid", paidAt: Date.UTC(2026, 9, 15), paymentMethod: "paystack", paymentReference: "snt-1" }, logo);
  const doc = await PDFDocument.load(paid);
  assert.equal(doc.getPageCount(), 1);
  assert.equal(doc.getTitle(), "Receipt DT-2026-0001");
  const unpaid = await PDFDocument.load(await pdf.buildInvoicePdf({ ...base, status: "issued", paidAt: null, paymentMethod: null, paymentReference: null }, null));
  assert.equal(unpaid.getTitle(), "Invoice DT-2026-0001", "no logo still builds");
  assert.equal(pdf.pdfText("A – “b” 中"), 'A - "b" ?');
  assert.equal(pdf.pdfMoney(4640, "KES"), "KES 4,640.00");
  assert.equal(pdf.invoiceFileName({ number: "DT-2026-0001", status: "paid" }), "Receipt-DT-2026-0001.pdf");
  assert.equal(pdf.invoiceFileName({ number: "DT-2026-0002", status: "issued" }), "Invoice-DT-2026-0002.pdf");
});

test("wiring: the receipt downloads when a payment is confirmed", () => {
  const payments = read("components/billing/billing-payments.tsx");
  assert.match(payments, /result\.status === "paid" \|\| result\.status === "already"[\s\S]{0,600}downloadInvoicePdf\(invoice\)/);
  assert.match(read("backend/convex/billing.ts"), /invoiceId: payment\.invoiceId/);
});
