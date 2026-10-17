import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { buildRawApiKey, randomKeySegment, sha256Hex } from "./lib/crypto";
import { FACE_MATCH_MESSAGES } from "./lib/faceMatch";
import { CAPTURE_LINK_HOURS, captureLink } from "./lib/capture";
import { recordClearedMatches } from "./amlCleared";
import { DEMO_LOGO_PNG_BASE64 } from "./lib/demoLogo";
import { buildWebhookPayload } from "./lib/webhookDispatch";

// More of Demo Bank Ltd for the manual's screenshots (demoSeed.ts holds the
// checks): a paid invoice, a logo, a former analyst, single sign-on, data
// removals, liveness requests, a four-eyes case, an API key, a webhook
// endpoint and its deliveries, a cleared hit, a monitoring alert, a data
// subject request, a rejected check nobody disputed and a capture link.
// Everything is invented and touches only the client marked isDemo:
//  - the invoice has its own DEMO- number, so the invoice sequence is untouched;
//  - the API key's secret is thrown away at once, so nobody can use it;
//  - the webhook endpoint is on demo-bank.example (never resolves) and set to
//    test events only, so Sentinel never sends live results to it;
//  - nothing is added to the PEP register or the risk lists, which every
//    client's screening reads.
// Each part is added once; running again adds nothing new, except a fresh
// capture link (its address can only be shown when it's made).
//
//   npx convex run demoScreens:add '{"confirm":"Demo Bank Ltd","sso":"pending"}'
//   then "connected" for the second single sign-on screenshot.

const internalApi: any = internal;
const DEMO_NAME = "Demo Bank Ltd";
const DAY = 86_400_000;
const confirm = v.literal(DEMO_NAME);

const ANALYST = { userId: "demo|faith-wambui", name: "Faith Wambui", email: "faith.wambui@demo-bank.example" };
const DEMO_INVOICE = "DEMO-2026-0001";
const KEY_LABEL = "Demo Bank core banking (test)";
const WEBHOOK_URL = "https://hooks.demo-bank.example/sentinel";
const coverage = { checked: [], missing: [], stale: [], openSanctions: "not_configured" as const, adverseMedia: "screened" as const };

type Input = Record<string, unknown> | null;
const field = (row: Doc<"verifications">, key: string) => (row.input as Input)?.[key];

export const _state = internalQuery({
  args: {},
  handler: async (ctx) => {
    const client = (await ctx.db.query("clients").take(1000)).find((row) => row.isDemo);
    if (!client) return null;
    const rows = await ctx.db.query("verifications").withIndex("by_client", (q) => q.eq("clientId", client._id)).take(1000);
    const find = (predicate: (row: Doc<"verifications">) => boolean) => rows.find(predicate)?._id ?? null;
    const members = await ctx.db.query("clientMembers").withIndex("by_client", (q) => q.eq("clientId", client._id)).take(50);
    const admin = members.find((member) => member.isActive && member.role === "client_admin" && !member.userId.startsWith("demo|"));
    const settings = await ctx.db.query("clientSettings").withIndex("by_client", (q: any) => q.eq("clientId", client._id)).first();
    const subjects = await ctx.db.query("amlMonitoredSubjects").withIndex("by_client_and_status", (q) => q.eq("clientId", client._id)).take(50);
    return {
      clientId: client._id,
      adminUserId: admin?.userId ?? null,
      hasLogo: Boolean(settings?.profile?.logoStorageId),
      kycPassId: find((row) => row.type === "idp" && field(row, "firstName") === "Wanjiku"),
      kenyanIdRef: rows.find((row) => row.type === "document" && field(row, "externalRef") === "CUST-1001")?.reference ?? null,
      clearedDone: Boolean(find((row) => row.type === "aml" && field(row, "subjectName") === "Mary Wanjiru Kamau")),
      fourEyesDone: Boolean(find((row) => row.type === "aml" && field(row, "subjectName") === "Grace Akinyi Odhiambo")),
      alertDone: rows.some((row) => row.type === "aml" && Boolean((field(row, "monitoring") as { subject?: string } | undefined)?.subject)),
      rejectedDone: Boolean(find((row) => row.type === "idp" && field(row, "firstName") === "Samuel" && field(row, "lastName") === "Cheruiyot")),
      monitoredSubject: subjects.find((row) => row.subjectName === "Daniel Kipruto Langat" && row.status === "active") ?? null,
    };
  },
});

export const _setLogo = internalMutation({
  args: { clientId: v.id("clients"), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("clientSettings").withIndex("by_client", (q: any) => q.eq("clientId", args.clientId)).first();
    if (!row) return;
    await ctx.db.patch(row._id, { profile: { ...(row.profile ?? {}), logoStorageId: args.storageId } as Doc<"clientSettings">["profile"], updatedAt: Date.now() });
  },
});

// The rows that need no check behind them.
export const _addRows = internalMutation({
  args: { clientId: v.id("clients"), adminUserId: v.string(), kycPassId: v.union(v.id("verifications"), v.null()), kenyanIdRef: v.union(v.string(), v.null()), sso: v.union(v.literal("pending"), v.literal("connected"), v.literal("none")) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const added: string[] = [];
    const settings = await ctx.db.query("clientSettings").withIndex("by_client", (q: any) => q.eq("clientId", args.clientId)).first();
    const adminName = (await ctx.db.query("userProfiles").withIndex("by_user_id", (q) => q.eq("userId", args.adminUserId)).first())?.name ?? "Admin";

    // A2: a paid top-up invoice, outside the real invoice sequence.
    if (!(await ctx.db.query("invoices").withIndex("by_number", (q) => q.eq("number", DEMO_INVOICE)).first())) {
      const subtotal = 200_000;
      const vat = 32_000;
      await ctx.db.insert("invoices", {
        clientId: args.clientId,
        number: DEMO_INVOICE,
        kind: "top_up",
        status: "paid",
        currency: "KES",
        lines: [{ description: "Sentinel credits top-up: 5,000 credits", quantity: 1, unitPrice: subtotal, amount: subtotal }],
        subtotal,
        vatRatePct: 16,
        vat,
        total: subtotal + vat,
        credits: 5_000,
        buyer: { name: "Demo Bank Limited", address: "Demo Towers, Upper Hill, Nairobi", kraPin: "P000000000D", email: "accounts@demo-bank.example" },
        seller: { name: "DeepTrack", address: "Nairobi, Kenya", email: "billing@deeptrack.io" },
        issuedAt: now - 20 * DAY,
        dueAt: now - 6 * DAY,
        createdBy: args.adminUserId,
        paidAt: now - 18 * DAY,
        paymentMethod: "bank_transfer",
        paymentReference: "DEMO-TRF-0001",
        notes: "Demo invoice for the user manual.",
      });
      added.push("invoice");
    }

    // A5, B11: a former analyst (never signs in; the id is not an Auth0 user).
    if (!(await ctx.db.query("clientMembers").withIndex("by_client_and_user", (q) => q.eq("clientId", args.clientId).eq("userId", ANALYST.userId)).first())) {
      await ctx.db.insert("clientMembers", { clientId: args.clientId, userId: ANALYST.userId, role: "compliance_analyst", isActive: false, invitedBy: args.adminUserId, deactivatedAt: now - DAY, deactivatedBy: args.adminUserId, createdAt: now - 200 * DAY });
      if (!(await ctx.db.query("userProfiles").withIndex("by_user_id", (q) => q.eq("userId", ANALYST.userId)).first())) {
        await ctx.db.insert("userProfiles", { userId: ANALYST.userId, name: ANALYST.name, email: ANALYST.email, updatedAt: now });
      }
      added.push("former analyst");
    }

    // A6: single sign-on, waiting for the provider's details or connected.
    // No Auth0 connection exists and enforcement stays off, so nobody's
    // sign-in changes.
    if (settings && args.sso !== "none") {
      const connectionName = settings.sso?.connectionName ?? "sso-demobank0001";
      const sso = {
        status: args.sso,
        provider: "entra_id" as const,
        connectionName,
        domains: ["demo-bank.example"],
        enforce: false,
        ...(args.sso === "connected" ? { connectionId: "con_demo0000000000", connectedAt: now, connectedBy: args.adminUserId } : {}),
      };
      await ctx.db.patch(settings._id, { sso, ssoConnectionName: args.sso === "connected" ? connectionName : undefined, updatedAt: now });
      added.push(`single sign-on (${args.sso})`);
    }

    // A11, D6: one completed removal and one waiting for a second Admin.
    const purges = await ctx.db.query("retentionPurges").withIndex("by_client_and_requested_at", (q) => q.eq("clientId", args.clientId)).take(10);
    if (purges.length === 0) {
      const holds = { openCase: 0, monitoring: 0, str: 0, unfinished: 0 };
      await ctx.db.insert("retentionPurges", {
        clientId: args.clientId, status: "completed", retentionMonths: 84, cutoff: now - 2600 * DAY, estimated: 41, estimateCapped: false,
        requestedBy: args.adminUserId, requestedByName: adminName, requestedAt: now - 95 * DAY,
        approvedBy: ANALYST.userId, approvedByName: ANALYST.name, approvedAt: now - 94 * DAY,
        purged: 38, held: 3, holds: { openCase: 2, monitoring: 1, str: 0, unfinished: 0 }, relatedRemoved: 112, completedAt: now - 94 * DAY,
      });
      await ctx.db.insert("retentionPurges", {
        clientId: args.clientId, status: "pending_approval", retentionMonths: 84, cutoff: now - 2556 * DAY, estimated: 12, estimateCapped: false,
        requestedBy: args.adminUserId, requestedByName: adminName, requestedAt: now - 2 * 3_600_000,
        purged: 0, held: 0, holds, relatedRemoved: 0,
      });
      added.push("removals");
    }

    // B4: liveness requests already sent (nothing is texted).
    if ((await ctx.db.query("livenessRequests").withIndex("by_client", (q) => q.eq("clientId", args.clientId)).take(1)).length === 0) {
      await ctx.db.insert("livenessRequests", { clientId: args.clientId, contact: "+254700000101", method: "sms", status: "completed", deliveryStatus: "delivered", createdAt: now - 3 * DAY, sentAt: now - 3 * DAY, completedAt: now - 3 * DAY + 600_000, ...(args.kycPassId ? { verificationId: args.kycPassId } : {}) });
      await ctx.db.insert("livenessRequests", { clientId: args.clientId, contact: "+254700000102", method: "whatsapp", status: "pending", deliveryStatus: "delivered", createdAt: now - 5 * 3_600_000, sentAt: now - 5 * 3_600_000 });
      await ctx.db.insert("livenessRequests", { clientId: args.clientId, contact: "+254700000103", method: "sms", status: "failed", deliveryStatus: "undelivered", createdAt: now - DAY, sentAt: now - DAY, failureReason: "The phone was switched off; the message expired." });
      added.push("liveness requests");
    }

    // C1-C4: a test key; its secret is never kept, so it can't be used.
    const keys = await ctx.db.query("apiKeys").withIndex("by_client", (q) => q.eq("clientId", args.clientId)).take(20);
    if (!keys.some((key) => key.label === KEY_LABEL)) {
      const { rawKey, prefix } = buildRawApiKey("test");
      await ctx.db.insert("apiKeys", {
        clientId: args.clientId, prefix, hashedKey: await sha256Hex(`${rawKey}:${randomKeySegment(16)}`), environment: "test", revoked: false,
        createdAt: now - 30 * DAY, lastUsedAt: now - 2 * 3_600_000, label: KEY_LABEL,
        scopes: ["verify:kyc", "verify:document", "verify:aml", "monitoring", "results:read"], createdBy: args.adminUserId,
      });
      added.push("API key");
    }

    // C2, C7: an endpoint for test events only, a delivered test event and a
    // KYC result delivered on the third attempt.
    const endpoints = await ctx.db.query("webhookEndpoints").withIndex("by_client", (q) => q.eq("clientId", args.clientId)).take(10);
    if (!endpoints.some((endpoint) => endpoint.url === WEBHOOK_URL)) {
      const endpointId = await ctx.db.insert("webhookEndpoints", {
        clientId: args.clientId, url: WEBHOOK_URL, description: "Core banking onboarding service", secret: randomKeySegment(32),
        events: ["sentinel.scan.complete", "sentinel.review.decided", "sentinel.monitoring.alert"], environment: "test",
        status: "active", consecutiveFailures: 0, createdAt: now - 30 * DAY, createdBy: args.adminUserId, updatedAt: now - 30 * DAY,
      });
      const testAt = now - 30 * DAY;
      const testPayload = { event: "sentinel.test", scan_id: `test_${randomKeySegment(12)}`, status: "PASS", timestamp: new Date(testAt).toISOString(), product: null, result: { test: true, message: "A test event from Sentinel. Verify the signature, then return any 2xx status." } };
      await ctx.db.insert("webhookDeliveries", { clientId: args.clientId, endpointId, event: "sentinel.test", payload: testPayload, createdAt: testAt, status: "delivered", attemptCount: 1, lastAttemptAt: now - 30 * DAY, lastResponseStatus: 200, lastLatencyMs: 182, attempts: [{ at: now - 30 * DAY, statusCode: 200, latencyMs: 182 }], test: true });
      const kyc = args.kycPassId ? await ctx.db.get(args.kycPassId) : null;
      if (kyc) {
        const first = now - 4 * DAY;
        const payload = { ...buildWebhookPayload({ reference: kyc.reference, verdict: kyc.verdict ?? "pass", result: kyc.result }), product: "kyc" };
        await ctx.db.insert("webhookDeliveries", {
          clientId: args.clientId, verificationId: kyc._id, endpointId, event: "sentinel.scan.complete", payload, createdAt: first, status: "delivered", attemptCount: 3,
          lastAttemptAt: first + 90_000, lastResponseStatus: 200, lastLatencyMs: 240,
          attempts: [{ at: first, statusCode: 503, latencyMs: 1200, error: "Service Unavailable" }, { at: first + 30_000, error: "Timed out after 10 s" }, { at: first + 90_000, statusCode: 200, latencyMs: 240 }],
        });
      }
      added.push("webhook endpoint");
    }

    // D6: an open erasure request (the subject is a check reference, as the
    // Back Office asks).
    const requests = await ctx.db.query("dataRequests").withIndex("by_received_at").order("desc").take(200);
    if (!requests.some((row) => row.clientId === args.clientId)) {
      await ctx.db.insert("dataRequests", { requestType: "erasure", subject: args.kenyanIdRef ?? "Demo Bank customer CUST-1001", clientId: args.clientId, status: "open", receivedAt: now - 3 * DAY, dueAt: now + 27 * DAY, notes: "Customer closed their account and asked for their data to be erased.", createdBy: args.adminUserId, updatedAt: now - 3 * DAY });
      added.push("data request");
    }

    // B3: a capture link for Halima, in Kiswahili. The link is returned once.
    const token = randomKeySegment(32);
    await ctx.db.insert("captureSessions", {
      clientId: args.clientId, tokenHash: await sha256Hex(token), reference: `cap_${randomKeySegment(16)}`, status: "pending", method: "link", language: "sw",
      prefill: { firstName: "Halima", lastName: "Abdi", gender: "female" }, externalRef: "CUST-3307", deliveryStatus: "not_sent",
      createdBy: args.adminUserId, createdAt: now, expiresAt: now + CAPTURE_LINK_HOURS * 3_600_000,
    });
    const appUrl = (process.env.SENTINEL_APP_URL?.trim() || "https://sentinel.deeptrack.io").replace(/\/+$/, "");
    return { added, captureLink: captureLink(appUrl, token) };
  },
});

// A7: a reviewer cleared a false positive, so it's remembered for this customer.
export const _clearHit = internalMutation({
  args: { verificationId: v.id("verifications") },
  handler: async (ctx, args) => {
    const verification = (await ctx.db.get(args.verificationId))!;
    const review = await ctx.db.query("reviewQueue").withIndex("by_verification", (q) => q.eq("verificationId", args.verificationId)).first();
    if (!review) return 0;
    const now = Date.now();
    await ctx.db.patch(review._id, { status: "resolved", resolutionAction: "confirm", resolvedBy: ANALYST.userId, resolvedByName: ANALYST.name, resolvedAt: now - 10 * DAY, decisionSource: "client", reasonCode: "False positive: different person or entity", resolutionNotes: "Different person: the listed Mary Wanjiru Kamau was born in 1961 and lives in the UK." });
    await ctx.db.patch(verification._id, { verdict: "pass" });
    return await recordClearedMatches(ctx, { verification: (await ctx.db.get(verification._id))!, reviewId: review._id, clearedBy: ANALYST.userId, clearedByName: ANALYST.name, reasonCode: "False positive: different person or entity" });
  },
});

// B11: the analyst recommended approving; four-eyes needs a second person.
export const _recommend = internalMutation({
  args: { verificationId: v.id("verifications") },
  handler: async (ctx, args) => {
    const review = await ctx.db.query("reviewQueue").withIndex("by_verification", (q) => q.eq("verificationId", args.verificationId)).first();
    if (!review) return false;
    await ctx.db.patch(review._id, {
      recommendation: { action: "approve", reasonCode: "Hit reviewed: risk within appetite", notes: "PEP confirmed (county official). Source of funds documented; approve with enhanced due diligence.", by: ANALYST.userId, byName: ANALYST.name, role: "compliance_analyst", at: Date.now() - 2 * DAY },
    });
    return true;
  },
});

export const _alertRaised = internalMutation({
  args: { subjectId: v.id("amlMonitoredSubjects") },
  handler: async (ctx, args) => {
    const subject = (await ctx.db.get(args.subjectId))!;
    await ctx.db.patch(args.subjectId, { alertCount: (subject.alertCount ?? 0) + 1, updatedAt: Date.now() });
  },
});

export const add = internalAction({
  args: { confirm, sso: v.optional(v.union(v.literal("pending"), v.literal("connected"), v.literal("none"))) },
  handler: async (ctx, args): Promise<{ added: string[]; captureLink?: string; reason?: string }> => {
    const state: any = await ctx.runQuery(internalApi.demoScreens._state, {});
    if (!state) return { added: [], reason: `${DEMO_NAME} doesn't exist. Run demoSeed:seed.` };
    if (!state.adminUserId) return { added: [], reason: `${DEMO_NAME} has no active Admin.` };
    const clientId: Id<"clients"> = state.clientId;
    const added: string[] = [];

    if (!state.hasLogo) {
      const bytes = Uint8Array.from(atob(DEMO_LOGO_PNG_BASE64), (char) => char.charCodeAt(0));
      const storageId = await ctx.storage.store(new Blob([bytes], { type: "image/png" }));
      await ctx.runMutation(internalApi.demoScreens._setLogo, { clientId, storageId });
      added.push("logo");
    }

    const rows: { added: string[]; captureLink: string } = await ctx.runMutation(internalApi.demoScreens._addRows, {
      clientId, adminUserId: state.adminUserId, kycPassId: state.kycPassId, kenyanIdRef: state.kenyanIdRef, sso: args.sso ?? "none",
    });
    added.push(...rows.added);

    const create = async (type: "idp" | "aml", input: Record<string, unknown>): Promise<Id<"verifications">> =>
      (await ctx.runMutation(internalApi.demoSeed._insertVerification, { clientId, type, input })).id;

    if (!state.clearedDone) {
      const id = await create("aml", { subjectName: "Mary Wanjiru Kamau", entityType: "individual", country: "KE", dateOfBirth: "1987-05-30", nationality: "KE", idNumber: "26631870", externalRef: "CUST-2210" });
      await ctx.runMutation(internalApi.amlPersistence.complete, {
        verificationId: id, clientId, subjectName: "Mary Wanjiru Kamau", verdict: "review",
        reason: "Possible match on a watch list: MARY WANJIRU KAMAU (demo entry). A person must confirm or clear it.",
        matches: [{ source: "OPENSANCTIONS", sourceRecordId: "demo-os-0042", entityName: "MARY WANJIRU KAMAU", program: "Demo watch list (invented for training)", matchScore: 88, matchMethod: "normalized", riskLevel: "high", categories: ["special_interest"], matchedCountry: "GB", birthDateMatch: "mismatch" }],
        coverage, chargeCredits: false, complete: true,
      });
      await ctx.runMutation(internalApi.demoScreens._clearHit, { verificationId: id });
      added.push("cleared hit");
    }

    if (!state.fourEyesDone) {
      const id = await create("aml", { subjectName: "Grace Akinyi Odhiambo", entityType: "individual", country: "KE", dateOfBirth: "1979-11-03", nationality: "KE", idNumber: "21987456", externalRef: "CUST-2984" });
      await ctx.runMutation(internalApi.amlPersistence.complete, {
        verificationId: id, clientId, subjectName: "Grace Akinyi Odhiambo", verdict: "review",
        reason: "Possible Kenyan PEP: Grace Akinyi Odhiambo (County Executive Committee Member, Kisumu). A person must confirm the match and apply enhanced due diligence.",
        matches: [{ source: "KE_PEP", sourceRecordId: "demo-pep-002", entityName: "Grace Akinyi Odhiambo", program: "County Executive Committee Member for Finance, Kisumu County (demo entry)", matchScore: 97, matchMethod: "normalized", riskLevel: "high", categories: ["pep"], pepClass: 3, pepStatus: "current", matchedCountry: "KE", birthDateMatch: "match" }],
        coverage, chargeCredits: false, complete: true,
      });
      await ctx.runMutation(internalApi.demoScreens._recommend, { verificationId: id });
      added.push("four-eyes case");
    }

    if (!state.alertDone && state.monitoredSubject) {
      const subject = state.monitoredSubject as Doc<"amlMonitoredSubjects">;
      const id = await create("aml", {
        subjectName: subject.subjectName, entityType: subject.entityType, country: subject.country, dateOfBirth: subject.dateOfBirth, nationality: subject.nationality, idNumber: subject.idNumber,
        monitoring: { subject: subject.reference, ...(subject.externalRef ? { externalRef: subject.externalRef } : {}) },
      });
      const media = { source: "ADVERSE_MEDIA", sourceRecordId: "demo-media-0007", entityName: "Daniel Kipruto Langat", program: "Demo news report: county land allocation inquiry (invented for training)", matchScore: 91, matchMethod: "ai_classification", riskLevel: "high", categories: ["adverse_media"], matchedCountry: "KE" };
      await ctx.runMutation(internalApi.amlPersistence.complete, {
        verificationId: id, clientId, subjectName: subject.subjectName, verdict: "review",
        reason: "Ongoing monitoring: 1 new hit. Adverse media: a news report links Daniel Kipruto Langat to a county land allocation inquiry (demo report).",
        matches: [...subject.hits.map((hit: any) => ({ source: hit.source, sourceRecordId: hit.sourceRecordId, entityName: hit.entityName, program: "Member of the County Assembly, Nakuru County (Kenya Gazette, 2022)", matchScore: 96, matchMethod: "normalized", riskLevel: hit.riskLevel, categories: hit.categories, ...(hit.pepClass ? { pepClass: hit.pepClass } : {}), matchedCountry: "KE" })), media],
        coverage, chargeCredits: false, complete: true,
        monitoring: { subjectId: subject._id, reference: subject.reference, ...(subject.externalRef ? { externalRef: subject.externalRef } : {}), added: [{ key: "ADVERSE_MEDIA:demo-media-0007", entityName: media.entityName, categories: ["adverse_media"] }], escalated: [] },
      });
      await ctx.runMutation(internalApi.demoScreens._alertRaised, { subjectId: subject._id });
      added.push("monitoring alert");
    }

    if (!state.rejectedDone) {
      const id = await create("idp", { firstName: "Samuel", lastName: "Cheruiyot", idNumber: "28811904", dateOfBirth: "1990-08-21", gender: "male", documentType: "id_card", livenessCollected: true, livenessMediaType: "mp4", faceCheckRequested: true });
      await ctx.runMutation(internalApi.verifications._complete, {
        id, verdict: "reject", confidence: 0,
        result: {
          docScan: { fakeScore: 0.07, flags: [], documentType: "id_card" },
          liveness: { livenessScore: 0.41, deepfakeFlag: true, confidence: 0.9 },
          iprs: { status: "MATCH" },
          aml: { status: "CLEAR", matches: [] },
          faceCheck: { provider: "deeptrack_live", prediction: "fake", confidencePct: 96, fakeProbability: 0.96, warning: null },
          faceMatch: { status: "completed", probe: "selfie", outcome: "uncertain", similarity: 79.4, message: FACE_MATCH_MESSAGES.uncertain, duplicateSearch: true, duplicates: [] },
        },
      });
      added.push("rejected KYC (not disputed)");
    }

    return { added, captureLink: rows.captureLink };
  },
});
