import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { buildVerificationReference, randomKeySegment, sha256Hex } from "./lib/crypto";
import { documentVerdict, identityRuleChecks, kraPinChecks, mrzCheckDigit, type IdentityFields, type KraPinFields } from "./lib/documentChecks";
import { certificateRules, cr12AgainstRegistry, type BusinessRegistrationFields } from "./lib/kybChecks";
import { compareBrs, type BrsLookup } from "./lib/kenyaBrs";
import { buildOwnership, traceOwnership, undeclaredOwners, UBO_THRESHOLD_PCT } from "./lib/ownership";
import { FACE_MATCH_MESSAGES } from "./lib/faceMatch";
import { DEFAULT_MONITORING, evaluateTransactions, toUsd, type Txn } from "./lib/transactionRules";
import { FATF_DEFAULTS } from "./lib/riskRating";
import { CAPTURE_LINK_HOURS, captureLink } from "./lib/capture";
import { queueReview } from "./clientReviews";

// "Demo Bank Ltd": an invented organization for the user manual's
// screenshots and the training videos. Every person, company, ID number and
// phone number is made up. The checks go through Sentinel's real
// completion code (verdicts, review cases, risk ratings, fraud network)
// with prepared results, so nothing calls an identity, registry or
// watchlist provider and no credits are charged.
//
//   npx convex run demoSeed:seed '{"confirm":"Demo Bank Ltd","memberUserIds":["auth0|…"]}'
//   npx convex run demoSeed:reset '{"confirm":"Demo Bank Ltd"}'   (repeat until done)

const internalApi: any = internal;
const DEMO_NAME = "Demo Bank Ltd";
const DAY = 86_400_000;
const confirm = v.literal(DEMO_NAME);

// ── Building blocks ───────────────────────────────────────────────────────

export const _createClient = internalMutation({
  args: { memberUserIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const existing = (await ctx.db.query("clients").take(1000)).find((client) => client.isDemo);
    if (existing) throw new ConvexError({ code: "exists", message: `${DEMO_NAME} already exists. Run demoSeed:reset first.` });
    const now = Date.now();
    const clientId = await ctx.db.insert("clients", {
      name: DEMO_NAME,
      plan: "business",
      status: "active",
      creditLimit: 0,
      creditBalance: 5_000_000,
      rpmCap: 300,
      creditThresholdPct: 10,
      billingCurrency: "KES",
      isDemo: true,
      createdAt: now,
    });
    await ctx.db.insert("clientSettings", {
      clientId,
      profile: {
        legalName: "Demo Bank Limited",
        registrationNumber: "PVT-DEMO0001",
        regulator: "CBK",
        licenceNumber: "CBK/DEMO/001",
        address: "Demo Towers, Upper Hill, Nairobi",
        city: "Nairobi",
        complianceContactName: "Faith Demo",
        complianceContactEmail: "compliance@demo-bank.example",
        goamlEntityId: "DEMO-0001",
      },
      updatedAt: now,
      updatedBy: "demo-seed",
    });
    for (const userId of args.memberUserIds) {
      await ctx.db.insert("clientMembers", { clientId, userId, role: "client_admin", isActive: true, invitedBy: "demo-seed", createdAt: now });
    }
    return clientId;
  },
});

export const _insertVerification = internalMutation({
  args: { clientId: v.id("clients"), type: v.union(v.literal("idp"), v.literal("document"), v.literal("aml"), v.literal("kyb")), input: v.any() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const reference = buildVerificationReference();
    const id = await ctx.db.insert("verifications", { clientId: args.clientId, type: args.type, status: "processing", creditsUsed: 0, input: args.input, reference, createdAt: now, updatedAt: now });
    return { id, reference };
  },
});

export const _insertDirectors = internalMutation({
  args: { clientId: v.id("clients"), verificationId: v.id("verifications"), directors: v.array(v.object({ firstName: v.string(), lastName: v.string(), email: v.string(), position: v.string(), shareholding: v.string(), dateOfBirth: v.string(), idNumber: v.string() })) },
  handler: async (ctx, args) => {
    const ids: Id<"kybDirectors">[] = [];
    for (const director of args.directors) {
      ids.push(await ctx.db.insert("kybDirectors", { kybVerificationId: args.verificationId, clientId: args.clientId, ...director, status: "pending", createdAt: Date.now() }));
    }
    return ids;
  },
});

export const _verification = internalQuery({
  args: { id: v.id("verifications") },
  handler: async (ctx, args) => await ctx.db.get(args.id),
});

// ── Results ───────────────────────────────────────────────────────────────

const pad = (value: string, length: number) => (value + "<".repeat(length)).slice(0, length);

// A TD1 machine-readable zone with valid check digits.
function td1(documentNumber: string, optional: string, birth: string, sex: "M" | "F", expiry: string, surname: string, given: string): string[] {
  const number = pad(documentNumber, 9);
  const one = `IDKYA${number}${mrzCheckDigit(number)}${pad(optional, 15)}`;
  const expiryDigit = /^\d{6}$/.test(expiry) ? String(mrzCheckDigit(expiry)) : "<";
  const start = `${birth}${mrzCheckDigit(birth)}${sex}${pad(expiry, 6)}${expiryDigit}KEN`;
  const filler = pad("", 11);
  const composite = one.slice(5, 30) + start.slice(0, 7) + start.slice(8, 15) + filler;
  return [one, `${start}${filler}${mrzCheckDigit(composite)}`, pad(`${surname}<<${given.replace(/ /g, "<")}`, 30)];
}

function identityResult(fields: IdentityFields, extraFlags: Array<{ code: string; severity: "critical" | "high" | "medium" | "low"; source: "vision" | "file" | "rules" | "mrz" | "ocr"; message: string }>, summary: string, expected: { name?: string }) {
  const rules = identityRuleChecks(fields);
  const flags = [...extraFlags, ...rules.flags];
  const { verdict, riskScore } = documentVerdict(flags as never);
  const reason = verdict === "pass" ? "Identity document verified: no fraud signals and all checks passed." : `Identity document ${verdict === "reject" ? "rejected" : "needs review"}: ${flags.map((flag) => flag.message.replace(/\.$/, "")).slice(0, 3).join("; ")}.`;
  return {
    verdict,
    riskScore,
    reason,
    result: {
      documentKind: "identity",
      flags,
      identity: { fields, mrz: rules.mrz, age: rules.age, isAdult: rules.isAdult, isExpired: rules.isExpired, expectedNameMatch: expected.name ? 1 : null, expectedDateOfBirthMatch: null },
      forensics: { fileTypes: ["jpeg"], software: [], metadataAvailable: true },
      vision: { model: "claude-opus-5-5", summary, signals: [] },
      ocr: { status: "checked", provider: "aws_textract", averageConfidence: 97, checked: ["document number", "surname", "date of birth"], missing: [] },
      contentCredentials: { status: "checked", matches: 0, findings: [] },
      checks: [
        { name: "No visual fraud signals", status: extraFlags.some((flag) => flag.source === "vision") ? "failed" : "passed" },
        { name: "File metadata clean", status: "passed" },
        { name: "Machine-readable zone", status: rules.mrz ? (rules.mrz.checks.every((check) => check.valid) ? "passed" : "failed") : "not_applicable", detail: rules.mrz ? `${rules.mrz.format}, ${rules.mrz.checks.filter((check) => check.valid).length}/${rules.mrz.checks.length} check digits valid` : "No MRZ on the document" },
        { name: "Not expired", status: rules.isExpired === null ? "not_applicable" : rules.isExpired ? "failed" : "passed", detail: fields.expiryDate ?? undefined },
        { name: "Age 18+", status: rules.isAdult ? "passed" : "failed", detail: rules.age === null ? undefined : `${rules.age} years old` },
        { name: "Holder photo present", status: fields.hasFacePhoto ? "passed" : "failed" },
        { name: "OCR agrees with AI reading", status: "passed", detail: "3/3 values confirmed" },
      ],
    },
  };
}

const idFields = (overrides: Partial<IdentityFields>): IdentityFields => ({
  documentType: "national_id",
  issuingCountry: "KEN",
  documentNumber: null,
  surname: null,
  givenNames: null,
  fullName: null,
  dateOfBirth: null,
  sex: null,
  nationality: "KEN",
  placeOfBirth: null,
  issueDate: null,
  expiryDate: null,
  issuingAuthority: "Principal Registrar of Persons",
  address: null,
  personalNumber: null,
  serialNumber: null,
  kenyanIdType: null,
  mrzLines: [],
  hasFacePhoto: true,
  hasSignature: true,
  ...overrides,
});

const realFace = (confidencePct: number) => ({ provider: "deeptrack_live", prediction: "real", confidencePct, fakeProbability: Math.round((100 - confidencePct)) / 100, warning: null });
const kycSteps = (overrides: Record<string, unknown>) => ({
  docScan: { fakeScore: 0.06, flags: [], documentType: "id_card" },
  liveness: { livenessScore: 0.96, deepfakeFlag: false, confidence: 0.93 },
  iprs: { status: "MATCH" },
  aml: { status: "CLEAR", matches: [] },
  faceCheck: realFace(97),
  faceMatch: { status: "completed", probe: "selfie", outcome: "match", similarity: 98.6, message: FACE_MATCH_MESSAGES.match, duplicateSearch: true, duplicates: [] },
  ...overrides,
});

// The fraud network example (B10): James Mutua's ID number (kycFake) with
// another person's name and date of birth.
const NETWORK_EXAMPLE = { firstName: "Kevin", lastName: "Otieno", idNumber: "27650431", dateOfBirth: "1991-02-08", gender: "male" };

// ── The seed ──────────────────────────────────────────────────────────────

export const seed = internalAction({
  args: { confirm, memberUserIds: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    const clientId: Id<"clients"> = await ctx.runMutation(internalApi.demoSeed._createClient, { memberUserIds: args.memberUserIds ?? [] });
    const refs: Record<string, string> = {};
    const ids: Record<string, Id<"verifications">> = {};
    const create = async (key: string, type: "idp" | "document" | "aml" | "kyb", input: Record<string, unknown>) => {
      const created: { id: Id<"verifications">; reference: string } = await ctx.runMutation(internalApi.demoSeed._insertVerification, { clientId, type, input });
      refs[key] = created.reference;
      ids[key] = created.id;
      return created.id;
    };
    const kyc = (key: string, person: { firstName: string; lastName: string; idNumber: string; dateOfBirth: string; gender: string }) =>
      create(key, "idp", { ...person, documentType: "id_card", livenessCollected: true, livenessMediaType: "mp4", faceCheckRequested: true });

    // B2, B9: a clean KYC pass. Also the customer behind the transaction alerts.
    await kyc("kycPass", { firstName: "Wanjiku", lastName: "Mwangi", idNumber: "30458812", dateOfBirth: "1992-04-11", gender: "female" });
    await ctx.runMutation(internalApi.verifications._complete, { id: ids.kycPass, verdict: "pass", confidence: 1, result: kycSteps({}) });

    // B10: the face behind the duplicate.
    await kyc("kycGrace", { firstName: "Grace", lastName: "Achieng", idNumber: "31220976", dateOfBirth: "1995-09-02", gender: "female" });
    await ctx.runMutation(internalApi.verifications._complete, { id: ids.kycGrace, verdict: "pass", confidence: 1, result: kycSteps({ faceCheck: realFace(95) }) });

    // B2, B10: the selfie isn't the ID photo, and the same face was verified as Grace Achieng.
    await kyc("kycMismatch", { firstName: "Brenda", lastName: "Atieno", idNumber: "29917345", dateOfBirth: "1994-12-20", gender: "female" });
    const mismatch = "Face match: The selfie doesn't match the photo on the ID. The same face is on another customer verified under a different identity.";
    await ctx.runMutation(internalApi.verifications._completeWithReview, {
      id: ids.kycMismatch,
      clientId,
      result: kycSteps({
        faceMatch: { status: "completed", probe: "selfie", outcome: "mismatch", similarity: 38.2, message: FACE_MATCH_MESSAGES.mismatch, duplicateSearch: true, duplicates: [{ reference: refs.kycGrace, similarity: 99.1, sameIdentity: false, createdAt: Date.now() }] },
      }),
      triggerType: "auto_escalation",
      triggerReason: `${mismatch} (${refs.kycGrace})`,
      priority: "high",
    });

    // B9, B10, B15: DeepTrack Live flags the selfie as a synthetic face; the client disputes it.
    await kyc("kycFake", { firstName: "James", lastName: "Mutua", idNumber: "27650431", dateOfBirth: "1989-06-15", gender: "male" });
    await ctx.runMutation(internalApi.verifications._complete, { id: ids.kycFake, verdict: "reject", confidence: 0, result: kycSteps({ faceCheck: { provider: "deeptrack_live", prediction: "fake", confidencePct: 94, fakeProbability: 0.94, warning: null }, faceMatch: { status: "completed", probe: "selfie", outcome: "uncertain", similarity: 81.5, message: FACE_MATCH_MESSAGES.uncertain, duplicateSearch: true, duplicates: [] } }) });

    // B10: the fraud network. A new customer brings James Mutua's ID number
    // with another name and date of birth; the network sends the pass to review.
    await kyc("kycNetwork", NETWORK_EXAMPLE);
    await ctx.runMutation(internalApi.verifications._complete, { id: ids.kycNetwork, verdict: "pass", confidence: 1, result: kycSteps({ faceCheck: realFace(96) }) });

    // B5: a genuine second-generation Kenyan ID (no expiry; the MRZ carries the serial number).
    await create("docKenyanId", "document", { documentKind: "identity", pages: 2, expectedName: "Peter Njoroge Kamau", expectedAddress: null, expectedDateOfBirth: null, maxDocumentAgeDays: null, externalRef: "CUST-1001", resized: false });
    const secondGen = identityResult(
      idFields({ documentNumber: "24567813", surname: "KAMAU", givenNames: "PETER NJOROGE", fullName: "PETER NJOROGE KAMAU", dateOfBirth: "1985-03-07", sex: "M", placeOfBirth: "NYERI", issueDate: "2004-08-19", serialNumber: "201845673", kenyanIdType: "second_generation", mrzLines: td1("201845673", "24567813", "850307", "M", "", "KAMAU", "PETER NJOROGE") }),
      [],
      "A genuine-looking second-generation Kenyan national ID: consistent fonts, guilloche and hologram areas; the photo sits under the security print.",
      { name: "Peter Njoroge Kamau" },
    );
    await ctx.runMutation(internalApi.documents._complete, { verificationId: ids.docKenyanId, verdict: secondGen.verdict, reason: secondGen.reason, riskScore: secondGen.riskScore, chargeCredits: false, result: secondGen.result });

    // B5: a Maisha card.
    await create("docMaisha", "document", { documentKind: "identity", pages: 2, expectedName: "Amina Hassan Omar", expectedAddress: null, expectedDateOfBirth: "2001-01-23", maxDocumentAgeDays: null, externalRef: "CUST-1002", resized: false });
    const maisha = identityResult(
      idFields({ documentNumber: "KM0458219", personalNumber: "1004587721", surname: "OMAR", givenNames: "AMINA HASSAN", fullName: "AMINA HASSAN OMAR", dateOfBirth: "2001-01-23", sex: "F", placeOfBirth: "MOMBASA", issueDate: "2024-02-12", expiryDate: "2034-02-11", kenyanIdType: "maisha_card" }),
      [],
      "A Maisha card with its expected layout and security features; nothing suggests editing or generation.",
      { name: "Amina Hassan Omar" },
    );
    await ctx.runMutation(internalApi.documents._complete, { verificationId: ids.docMaisha, verdict: maisha.verdict, reason: maisha.reason, riskScore: maisha.riskScore, chargeCredits: false, result: maisha.result });

    // B5, B10: an AI-generated ID.
    await create("docAiId", "document", { documentKind: "identity", pages: 1, expectedName: "Daniel Ouma", expectedAddress: null, expectedDateOfBirth: null, maxDocumentAgeDays: null, externalRef: "CUST-1003", resized: false });
    const aiId = identityResult(
      idFields({ documentNumber: "33018842", surname: "OUMA", givenNames: "DANIEL", fullName: "DANIEL OUMA", dateOfBirth: "1990-10-30", sex: "M", issueDate: "2012-05-02", kenyanIdType: "second_generation" }),
      [
        { code: "visual_ai_generated", severity: "critical", source: "vision", message: "Looks AI-generated: the guilloche pattern melts into the photo and the micro-text is garbled." },
        { code: "visual_font_inconsistency", severity: "high", source: "vision", message: "Inconsistent fonts or spacing: the ID number uses a different typeface from the rest of the card." },
      ],
      "The card shows clear signs of image generation: warped background pattern, invented emblem detail and garbled micro-text.",
      { name: "Daniel Ouma" },
    );
    await ctx.runMutation(internalApi.documents._complete, { verificationId: ids.docAiId, verdict: aiId.verdict, reason: aiId.reason, riskScore: aiId.riskScore, chargeCredits: false, result: aiId.result });

    // B5: KRA PIN certificates, one confirmed by KRA and one KRA doesn't know.
    const kraDocument = async (key: string, fields: KraPinFields, expectedName: string, registry: Record<string, unknown>, extra: Array<{ code: string; severity: "high" | "medium"; message: string }>) => {
      await create(key, "document", { documentKind: "kra_pin", pages: 1, expectedName, expectedAddress: null, expectedDateOfBirth: null, maxDocumentAgeDays: null, externalRef: null, resized: false });
      const rules = kraPinChecks(fields, { name: expectedName });
      const flags = [...rules.flags, ...extra.map((flag) => ({ ...flag, source: "rules" as const }))];
      const { verdict, riskScore } = documentVerdict(flags as never);
      await ctx.runMutation(internalApi.documents._complete, {
        verificationId: ids[key],
        verdict,
        reason: verdict === "pass" ? "KRA PIN certificate verified: no fraud signals and all checks passed." : `KRA PIN certificate needs review: ${flags.map((flag) => flag.message.replace(/\.$/, "")).join("; ")}.`,
        riskScore,
        chargeCredits: false,
        result: {
          documentKind: "kra_pin",
          flags,
          kraPin: { fields, nameMatch: rules.nameMatch, registry },
          forensics: { fileTypes: ["pdf"], software: [], metadataAvailable: true },
          vision: { model: "claude-opus-5-5", summary: "A KRA iTax PIN certificate with the standard layout.", signals: [] },
          ocr: { status: "checked", provider: "aws_textract", averageConfidence: 99, checked: ["PIN", "taxpayer name"], missing: [] },
          contentCredentials: { status: "checked", matches: 0, findings: [] },
          checks: [{ name: "Issued by the Kenya Revenue Authority", status: "passed" }, ...rules.checks, { name: "PIN confirmed by KRA", status: registry.outcome === "verified" ? "passed" : "failed", detail: String(registry.message) }],
        },
      });
    };
    await kraDocument(
      "docKraOk",
      { pin: "A004512378K", taxpayerName: "WANJIKU MWANGI", taxpayerType: "individual", email: "w.mwangi@example.com", certificateDate: "2021-07-14", obligations: ["Income Tax - Resident Individual"], issuedByKra: true },
      "Wanjiku Mwangi",
      { outcome: "verified", message: "KRA confirms the PIN belongs to WANJIKU MWANGI (Active).", nameMatch: 1, name: "WANJIKU MWANGI", pinStatus: "Active", taxpayerType: "Individual" },
      [],
    );
    await kraDocument(
      "docKraUnknown",
      { pin: "A009988776Z", taxpayerName: "DANIEL OUMA", taxpayerType: "individual", email: "d.ouma@example.com", certificateDate: "2023-11-02", obligations: ["Income Tax - Resident Individual"], issuedByKra: true },
      "Daniel Ouma",
      { outcome: "not_registered", message: "KRA has no record of this PIN.", nameMatch: null, name: null, pinStatus: null, taxpayerType: null },
      [{ code: "kra_pin_not_registered", severity: "high", message: "KRA has no record of the PIN on this certificate." }],
    );

    // B6, B11, B12: a Kenyan PEP (Class 2) and a sanctions match.
    const coverage = { checked: [], missing: [], stale: [], openSanctions: "not_configured" as const, adverseMedia: "screened" as const };
    await create("amlPep", "aml", { subjectName: "Daniel Kipruto Langat", entityType: "individual", country: "KE", dateOfBirth: "1968-02-14", nationality: "KE", idNumber: "10458831", industry: "real_estate" });
    await ctx.runMutation(internalApi.amlPersistence.complete, {
      verificationId: ids.amlPep,
      clientId,
      subjectName: "Daniel Kipruto Langat",
      verdict: "review",
      reason: "Possible Kenyan PEP: Daniel Kipruto Langat (Member of the County Assembly, Nakuru). A person must confirm the match and apply enhanced due diligence.",
      matches: [{ source: "KE_PEP", sourceRecordId: "demo-pep-001", entityName: "Hon. Daniel Kipruto Langat", program: "Member of the County Assembly, Nakuru County (Kenya Gazette, 2022)", matchScore: 96, matchMethod: "normalized", riskLevel: "high", categories: ["pep"], pepClass: 2, pepStatus: "current", matchedCountry: "KE", birthDateMatch: "match" }],
      coverage,
      chargeCredits: false,
      complete: true,
    });
    await create("amlSanctions", "aml", { subjectName: "Viktor Petrovich Orlov", entityType: "individual", country: "AE", nationality: "RU" });
    await ctx.runMutation(internalApi.amlPersistence.complete, {
      verificationId: ids.amlSanctions,
      clientId,
      subjectName: "Viktor Petrovich Orlov",
      verdict: "reject",
      reason: "Exact match on a sanctions list: VIKTOR PETROVICH ORLOV (demo sanctions entry). Do not onboard; escalate to compliance.",
      matches: [{ source: "OFAC_SDN", sourceRecordId: "demo-sdn-001", entityName: "VIKTOR PETROVICH ORLOV", program: "DEMO SANCTIONS PROGRAM (invented for training)", matchScore: 100, matchMethod: "exact", riskLevel: "critical", categories: ["sanctions"], matchedCountry: "AE", countryMatch: "match" }],
      coverage,
      chargeCredits: false,
      complete: true,
    });

    // B8: a company with layered ownership and an old CR12 that doesn't match the register.
    const kybInput = { businessName: "Savannah Agri Holdings Ltd", registrationNumber: "PVT-SAV2019A", incorporationCountry: "KE", businessType: "agriculture", registrationDocUrl: "https://demo.invalid/cr12.pdf", proofOfAddressUrl: "https://demo.invalid/poa.pdf", directorCount: 2 };
    await create("kyb", "kyb", kybInput);
    const directorIds: Id<"kybDirectors">[] = await ctx.runMutation(internalApi.demoSeed._insertDirectors, {
      clientId,
      verificationId: ids.kyb,
      directors: [
        { firstName: "Peter", lastName: "Njoroge", email: "peter@savannah-agri.example", position: "Director", shareholding: "60%", dateOfBirth: "1979-05-21", idNumber: "21887654" },
        { firstName: "Mary", lastName: "Akinyi", email: "mary@savannah-agri.example", position: "Director", shareholding: "40%", dateOfBirth: "1983-11-08", idNumber: "23455120" },
      ],
    });
    const cr12: BusinessRegistrationFields = { documentType: "cr12", companyName: "SAVANNAH AGRI HOLDINGS LIMITED", registrationNumber: "PVT-SAV2019A", incorporationDate: "2019-03-12", jurisdiction: "KEN", issuingAuthority: "Business Registration Service", directors: ["Peter Njoroge", "Mary Akinyi"], documentDate: new Date(Date.now() - 140 * DAY).toISOString().slice(0, 10), shareholders: [{ name: "Peter Njoroge", shares: "600 ordinary shares" }, { name: "Mary Akinyi", shares: "400 ordinary shares" }] };
    const root: BrsLookup = { status: "found", record: { registrationNumber: "PVT-SAV2019A", companyName: "SAVANNAH AGRI HOLDINGS LIMITED", companyType: "Private Company", registrationDate: "2019-03-12", active: true, kraPin: "P051234567Q", physicalAddress: "Nakuru", shareholders: [{ name: "PETER NJOROGE", shares: "600", idType: "National ID", idNumber: "21887654" }, { name: "HIGHLAND CAPITAL LIMITED", shares: "400", idType: "Company", idNumber: "PVT-HCL2015B" }] } };
    const highland: BrsLookup = { status: "found", record: { registrationNumber: "PVT-HCL2015B", companyName: "HIGHLAND CAPITAL LIMITED", companyType: "Private Company", registrationDate: "2015-08-03", active: true, kraPin: null, physicalAddress: "Nairobi", shareholders: [{ name: "AHMED HASSAN FARAH", shares: "700", idType: "Passport", idNumber: null }, { name: "LUCY WAIRIMU", shares: "300", idType: "National ID", idNumber: "25554310" }] } };
    const certificateCheck = certificateRules(cr12, { businessName: kybInput.businessName, registrationNumber: kybInput.registrationNumber, directors: ["Peter Njoroge", "Mary Akinyi"] });
    const crossCheck = cr12AgainstRegistry(cr12, root.record.shareholders.map((holder) => holder.name));
    const certificateFlags = [...certificateCheck.flags, ...crossCheck.flags];
    const compared = compareBrs(root, { businessName: kybInput.businessName, registrationNumber: kybInput.registrationNumber, people: ["Peter Njoroge", "Mary Akinyi"] });
    const companies = await traceOwnership(root, async (number) => (number.replace(/[^A-Z0-9]/gi, "").toUpperCase() === "PVTHCL2015B" ? highland : { status: "not_found", message: "Not on the register." }));
    const tree = buildOwnership(root, companies);
    const missing = undeclaredOwners(tree, ["Peter Njoroge", "Mary Akinyi"]);
    const registryReason = `${compared.outcome.reason} Ownership: beneficial owners (${UBO_THRESHOLD_PCT}% or more) not declared: ${missing.map((owner) => `${owner.name}${owner.effectivePct !== null ? ` (${owner.effectivePct}%)` : ""}`).join(", ")}.`;
    await ctx.runMutation(internalApi.kyb._completeAutomated, {
      verificationId: ids.kyb,
      verdict: "review",
      reason: "Held for review: the CR12 is out of date and doesn't match the BRS register, and a beneficial owner wasn't declared.",
      complete: false,
      result: {
        certificate: { verdict: "review", reason: certificateFlags.map((flag) => flag.message).join(" "), fields: cr12, flags: certificateFlags, checks: [...certificateCheck.checks, ...crossCheck.checks], summary: "A BRS official search (CR12) with the standard layout.", software: [], model: "claude-opus-5-5" },
        proofOfAddress: { verdict: "pass", reason: "Proof of address verified: no fraud signals and all checks passed.", flags: [], fields: { documentType: "utility_bill", issuerName: "Kenya Power", holderName: "SAVANNAH AGRI HOLDINGS LTD", address: "Plot 14, Kenyatta Avenue, Nakuru", issueDate: new Date(Date.now() - 20 * DAY).toISOString().slice(0, 10), accountReference: "KP-DEMO-0042" }, checks: [] },
        registry: {
          provider: "metamap_brs",
          verdict: "review",
          reason: registryReason,
          checks: [...compared.checks, { name: "KRA PIN confirmed by KRA", status: "passed", detail: "KRA confirms the PIN belongs to SAVANNAH AGRI HOLDINGS LIMITED (Active)." }],
          kra: { pin: "P051234567Q", outcome: "verified", message: "KRA confirms the PIN belongs to SAVANNAH AGRI HOLDINGS LIMITED (Active).", nameMatch: 1 },
          record: root.record,
          ownership: { thresholdPct: UBO_THRESHOLD_PCT, nodes: tree.nodes, beneficialOwners: tree.beneficialOwners.map((owner) => owner.name), untraced: tree.untraced.map((node) => node.name), sharesKnown: tree.sharesKnown, lookups: companies.size },
        },
        parties: [
          { name: kybInput.businessName, role: "business", verdict: "pass", complete: true, reason: "No sanctions, PEP or adverse media hits.", hits: 0, suppressed: 0 },
          { name: "Peter Njoroge", role: "director", verdict: "pass", complete: true, reason: "No sanctions, PEP or adverse media hits.", hits: 0, suppressed: 0 },
          { name: "Mary Akinyi", role: "director", verdict: "pass", complete: true, reason: "No sanctions, PEP or adverse media hits.", hits: 0, suppressed: 0 },
          { name: "HIGHLAND CAPITAL LIMITED", role: "shareholder", verdict: "pass", complete: true, reason: "Company shareholder (40% of the business). No hits.", hits: 0, suppressed: 0 },
          ...missing.map((owner) => ({ name: owner.name, role: "ubo", verdict: "pass", complete: true, reason: `Beneficial owner found on the register through ${owner.path.join(" > ")} (${owner.effectivePct}% of the business), not declared. No hits.`, hits: 0, suppressed: 0 })),
        ],
      },
      parties: [
        { name: kybInput.businessName, verdict: "pass", hits: [] },
        { name: "Peter Njoroge", directorId: directorIds[0], verdict: "pass", hits: [] },
        { name: "Mary Akinyi", directorId: directorIds[1], verdict: "pass", hits: [] },
      ],
    });

    // B12-B15 and B3: monitoring, transactions, an STR, a dispute, capture links.
    const pep: Doc<"verifications"> = await ctx.runQuery(internalApi.demoSeed._verification, { id: ids.amlPep });
    const extras: { links: Record<string, string>; alerts: number } = await ctx.runMutation(internalApi.demoSeed._extras, {
      clientId,
      memberUserId: args.memberUserIds?.[0] ?? "demo-seed",
      pepId: ids.amlPep,
      pepRating: (pep.result as { riskRating?: unknown } | undefined)?.riskRating ?? null,
      structuringCustomer: refs.kycPass,
      structuringCheckId: ids.kycPass,
      disputedId: ids.kycFake,
    });
    return { client: DEMO_NAME, clientId, references: refs, captureLinks: extras.links, transactionAlerts: extras.alerts };
  },
});

let txnSeq = 0;
function txnRow(clientId: Id<"clients">, customerRef: string, now: number, rate: number | null, item: { daysAgo: number; hours?: number; amount: number; direction: "in" | "out"; channel: Doc<"transactions">["channel"]; counterpartyName?: string; counterpartyCountry?: string; narration?: string; currency?: "KES" | "USD" }) {
  txnSeq += 1;
  const currency = item.currency ?? "KES";
  return {
    clientId,
    externalId: `DEMO-TX-${String(txnSeq).padStart(4, "0")}`,
    customerRef,
    occurredAt: now - item.daysAgo * DAY - (item.hours ?? 0) * 3_600_000,
    amount: item.amount,
    currency,
    amountUsd: toUsd(item.amount, currency, rate) ?? item.amount / 130,
    direction: item.direction,
    channel: item.channel,
    ...(item.counterpartyName ? { counterpartyName: item.counterpartyName, counterpartyKey: item.counterpartyName.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim() } : {}),
    ...(item.counterpartyCountry ? { counterpartyCountry: item.counterpartyCountry } : {}),
    ...(item.narration ? { narration: item.narration } : {}),
    source: "upload" as const,
    createdAt: now,
  };
}

async function evaluateAndRaise(ctx: MutationCtx, clientId: Id<"clients">, customerRef: string, rows: Array<Doc<"transactions">>, newIds: Set<string>) {
  const config = { ...DEFAULT_MONITORING, callForAction: FATF_DEFAULTS.callForAction, increasedMonitoring: FATF_DEFAULTS.increasedMonitoring, homeCountry: "KE" };
  const alerts = evaluateTransactions(
    rows
      .map((row) => ({ id: row._id, occurredAt: row.occurredAt, amount: row.amount, currency: row.currency, amountUsd: row.amountUsd, direction: row.direction, channel: row.channel, counterpartyName: row.counterpartyName ?? null, counterpartyCountry: row.counterpartyCountry ?? null }) as Txn)
      .sort((a, b) => a.occurredAt - b.occurredAt),
    newIds,
    config,
  );
  const created: Array<{ id: Id<"transactionAlerts">; rule: string }> = [];
  for (const alert of alerts) {
    const id = await ctx.db.insert("transactionAlerts", { clientId, customerRef, rule: alert.rule, severity: alert.severity, status: "open", summary: alert.summary, transactionIds: alert.transactionIds as Id<"transactions">[], key: alert.key, createdAt: Date.now() });
    created.push({ id, rule: alert.rule });
  }
  return created;
}

export const _extras = internalMutation({
  args: { clientId: v.id("clients"), memberUserId: v.string(), pepId: v.id("verifications"), pepRating: v.any(), structuringCustomer: v.string(), structuringCheckId: v.id("verifications"), disputedId: v.id("verifications") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const rate = (await ctx.db.query("billingSettings").withIndex("by_key", (q) => q.eq("key", "default")).first())?.usdToKes ?? 130;

    // B12: a high-risk monitored customer whose periodic review is due.
    await ctx.db.insert("amlMonitoredSubjects", {
      clientId: args.clientId,
      reference: `mon_demo_${randomKeySegment(6)}`,
      status: "active",
      subjectName: "Daniel Kipruto Langat",
      entityType: "individual",
      country: "KE",
      dateOfBirth: "1968-02-14",
      nationality: "KE",
      idNumber: "10458831",
      externalRef: "CUST-PEP-01",
      enrolledVerificationId: args.pepId,
      enrolledBy: args.memberUserId,
      baselineSet: true,
      hits: [{ key: "KE_PEP:demo-pep-001", source: "KE_PEP", sourceRecordId: "demo-pep-001", entityName: "Hon. Daniel Kipruto Langat", categories: ["pep"], pepClass: 2, riskLevel: "high" }],
      screenCount: 14,
      alertCount: 0,
      lastScreenedAt: now - DAY,
      nextScreenAt: now + DAY,
      createdAt: now - 380 * DAY,
      updatedAt: now,
      ...(args.pepRating ? { riskRating: args.pepRating } : {}),
      nextReviewAt: now - 2 * DAY,
      lastReviewedAt: now - 367 * DAY,
    });

    // B13: transactions. Wanjiku (the clean KYC pass) structures cash deposits.
    const inserted: Array<Doc<"transactions">> = [];
    const add = async (customerRef: string, item: Parameters<typeof txnRow>[4]) => {
      const id = await ctx.db.insert("transactions", txnRow(args.clientId, customerRef, now, rate, item));
      inserted.push((await ctx.db.get(id))!);
    };
    for (let day = 60; day >= 3; day -= 1) await add(args.structuringCustomer, { daysAgo: day, amount: 2_000 + ((day * 137) % 6_000), direction: day % 3 ? "out" : "in", channel: "mpesa", counterpartyName: day % 3 ? "Naivas Supermarket" : "Salary - Demo Employer Ltd" });
    for (const daysAgo of [5, 3, 1]) await add(args.structuringCustomer, { daysAgo, amount: 1_850_000, direction: "in", channel: "cash", narration: "Cash deposit, Upper Hill branch" });
    // A mule account: money in from many senders, straight out.
    for (let day = 90; day >= 40; day -= 5) await add("CUST-2077", { daysAgo: day, amount: 3_500, direction: "in", channel: "mpesa", counterpartyName: "Small trader" });
    await add("CUST-2077", { daysAgo: 0, hours: 30, amount: 820_000, direction: "in", channel: "mpesa", counterpartyName: "Kevin Otieno" });
    await add("CUST-2077", { daysAgo: 0, hours: 20, amount: 690_000, direction: "in", channel: "mpesa", counterpartyName: "Faith Chebet" });
    await add("CUST-2077", { daysAgo: 0, hours: 2, amount: 1_470_000, direction: "out", channel: "bank_transfer", counterpartyName: "Orlov Trading FZE", counterpartyCountry: "AE", narration: "Goods payment" });
    // A wire to a call-for-action country and a large cash withdrawal.
    await add("CUST-3310", { daysAgo: 2, amount: 4_800, currency: "USD", direction: "out", channel: "swift", counterpartyName: "Tehran Import Co", counterpartyCountry: "IR", narration: "Invoice 2219" });
    await add("CUST-3310", { daysAgo: 1, amount: 2_400_000, direction: "out", channel: "cash", narration: "Cash withdrawal" });

    let alerts = 0;
    const byCustomer = new Map<string, Array<Doc<"transactions">>>();
    for (const row of inserted) byCustomer.set(row.customerRef, [...(byCustomer.get(row.customerRef) ?? []), row]);
    const recentIds = new Set(inserted.filter((row) => row.occurredAt > now - 6 * DAY).map((row) => row._id as string));
    let structuringAlert: { id: Id<"transactionAlerts">; rule: string } | undefined;
    for (const [customerRef, rows] of byCustomer) {
      const created = await evaluateAndRaise(ctx, args.clientId, customerRef, rows, recentIds);
      alerts += created.length;
      structuringAlert ??= created.find((alert) => alert.rule === "structuring");
    }
    // A sanctioned counterparty (the demo sanctions entry).
    const orlov = inserted.filter((row) => row.counterpartyName === "Orlov Trading FZE");
    await ctx.db.insert("transactionAlerts", { clientId: args.clientId, customerRef: "CUST-2077", rule: "sanctioned_counterparty", severity: "high", status: "open", summary: 'Counterparty "Orlov Trading FZE" matches a sanctions or watch list: linked to VIKTOR PETROVICH ORLOV (demo sanctions entry).', transactionIds: orlov.map((row) => row._id), key: "counterparty:ORLOV TRADING FZE:demo", createdAt: now });
    alerts += 1;

    // B14: the structuring alert escalated, with an STR draft.
    if (structuringAlert) {
      await ctx.db.patch(structuringAlert.id, { status: "escalated", decidedAt: now, decidedBy: args.memberUserId, decisionNotes: "Three cash deposits of KES 1.85m in five days, each just under the reporting threshold, with no business reason on file. Escalated for an STR." });
    }
    const largest = inserted.filter((row) => row.customerRef === args.structuringCustomer && row.channel === "cash").sort((a, b) => b.occurredAt - a.occurredAt)[0];
    await ctx.db.insert("strReports", {
      clientId: args.clientId,
      verificationId: args.structuringCheckId,
      reportCode: "STR",
      status: "draft",
      entityReference: `DEMO-STR-${randomKeySegment(3).toUpperCase()}`,
      reason: "The customer made three cash deposits of KES 1,850,000 within five days, each just below the KES reporting threshold, totalling KES 5,550,000. Her declared income is a monthly salary of about KES 85,000.",
      action: "Account placed under enhanced monitoring; customer asked for source of funds.",
      indicators: ["STRUCTURING"],
      transaction: { number: largest.externalId, date: largest.occurredAt, amount: largest.amount, description: "Cash deposit, Upper Hill branch", transmodeCode: "CASH" },
      createdBy: args.memberUserId,
      createdByName: "Faith Demo",
      createdAt: now,
      updatedAt: now,
    });

    // B15: the client disputes the rejected fake-selfie check.
    const disputed = await ctx.db.get(args.disputedId);
    if (disputed) {
      await ctx.db.patch(disputed._id, { disputeReason: "The customer was verified in person at our Westlands branch on the same day.", disputedAt: now, updatedAt: now });
      const reviewId = await queueReview(ctx, { verificationId: disputed._id, clientId: args.clientId, triggerType: "client_dispute", triggerReason: "Client dispute: The customer was verified in person at our Westlands branch on the same day.", priority: "high" });
      await ctx.db.patch(reviewId, { disputedVerdict: "reject", expectedVerdict: "pass" });
    }

    // B3: capture links in English and Kiswahili (shown once, here).
    const links: Record<string, string> = {};
    const appUrl = (process.env.SENTINEL_APP_URL?.trim() || "https://sentinel.deeptrack.io").replace(/\/+$/, "");
    for (const [key, language, firstName] of [["english", "en", "Joseph"], ["kiswahili", "sw", "Halima"]] as const) {
      const token = randomKeySegment(32);
      await ctx.db.insert("captureSessions", {
        clientId: args.clientId,
        tokenHash: await sha256Hex(token),
        status: "pending",
        method: "link",
        language,
        prefill: { firstName },
        externalRef: `CUST-CAP-${language.toUpperCase()}`,
        deliveryStatus: "not_sent",
        createdBy: args.memberUserId,
        createdAt: now,
        expiresAt: now + CAPTURE_LINK_HOURS * 60 * 60 * 1000,
      });
      links[key] = captureLink(appUrl, token);
    }
    return { links, alerts };
  },
});

// ── Adding to an existing Demo Bank ───────────────────────────────────────

export const _networkExampleState = internalQuery({
  args: {},
  handler: async (ctx) => {
    const client = (await ctx.db.query("clients").take(1000)).find((row) => row.isDemo);
    if (!client) return null;
    const rows = await ctx.db.query("verifications").withIndex("by_client", (q) => q.eq("clientId", client._id)).take(1000);
    const idNumber = (row: Doc<"verifications">) => (row.input as { idNumber?: string; firstName?: string } | null) ?? {};
    return {
      clientId: client._id,
      exists: rows.some((row) => row.type === "idp" && idNumber(row).idNumber === NETWORK_EXAMPLE.idNumber && idNumber(row).firstName === NETWORK_EXAMPLE.firstName),
      hasEarlier: rows.some((row) => row.type === "idp" && idNumber(row).idNumber === NETWORK_EXAMPLE.idNumber && row.status === "completed"),
    };
  },
});

// Adds the fraud network example to a Demo Bank seeded before it existed,
// without a reset. Runs once; a second run changes nothing.
//   npx convex run demoSeed:addFraudNetworkExample '{"confirm":"Demo Bank Ltd"}'
export const addFraudNetworkExample = internalAction({
  args: { confirm },
  handler: async (ctx): Promise<{ added: boolean; reference?: string; reason?: string }> => {
    const state: { clientId: Id<"clients">; exists: boolean; hasEarlier: boolean } | null = await ctx.runQuery(internalApi.demoSeed._networkExampleState, {});
    if (!state) return { added: false, reason: `${DEMO_NAME} doesn't exist. Run demoSeed:seed.` };
    if (state.exists) return { added: false, reason: "Already added." };
    if (!state.hasEarlier) return { added: false, reason: "James Mutua's check is missing, so there is nothing to match." };
    const created: { id: Id<"verifications">; reference: string } = await ctx.runMutation(internalApi.demoSeed._insertVerification, {
      clientId: state.clientId,
      type: "idp",
      input: { ...NETWORK_EXAMPLE, documentType: "id_card", livenessCollected: true, livenessMediaType: "mp4", faceCheckRequested: true },
    });
    await ctx.runMutation(internalApi.verifications._complete, { id: created.id, verdict: "pass", confidence: 1, result: kycSteps({ faceCheck: realFace(96) }) });
    return { added: true, reference: created.reference };
  },
});

// ── Reset ─────────────────────────────────────────────────────────────────

const PER_TABLE = 400;

// Removes Demo Bank Ltd and everything it holds, in batches: run until it
// returns done. Only ever touches the client marked isDemo.
export const reset = internalMutation({
  args: { confirm },
  handler: async (ctx) => {
    const client = (await ctx.db.query("clients").take(1000)).find((row) => row.isDemo);
    if (!client) return { done: true, removed: 0 };
    let removed = 0;
    const drop = async (rows: Array<{ _id: Id<any> }>) => {
      for (const row of rows) {
        await ctx.db.delete(row._id);
        removed += 1;
      }
    };
    const verifications = await ctx.db.query("verifications").withIndex("by_client", (q) => q.eq("clientId", client._id)).take(50);
    for (const verification of verifications) {
      for (const table of ["flaggedEntities", "fraudSignals", "kybRegistryLookups", "webhookDeliveries"] as const) {
        await drop(await ctx.db.query(table).withIndex("by_verification", (q: any) => q.eq("verificationId", verification._id)).take(PER_TABLE));
      }
      await drop(await ctx.db.query("reviewQueue").withIndex("by_verification", (q) => q.eq("verificationId", verification._id)).take(PER_TABLE));
      await drop(await ctx.db.query("kybDirectors").withIndex("by_kyb_verification", (q) => q.eq("kybVerificationId", verification._id)).take(PER_TABLE));
      await drop(await ctx.db.query("strReports").withIndex("by_verification", (q) => q.eq("verificationId", verification._id)).take(PER_TABLE));
      await ctx.db.delete(verification._id);
      removed += 1;
    }
    await drop(await ctx.db.query("amlMonitoredSubjects").withIndex("by_client_and_status", (q) => q.eq("clientId", client._id)).take(PER_TABLE));
    await drop(await ctx.db.query("transactionAlerts").withIndex("by_client_and_status", (q) => q.eq("clientId", client._id)).take(PER_TABLE));
    await drop(await ctx.db.query("transactions").withIndex("by_client_customer_time", (q) => q.eq("clientId", client._id)).take(PER_TABLE));
    await drop(await ctx.db.query("counterpartyScreenings").withIndex("by_client_and_key", (q) => q.eq("clientId", client._id)).take(PER_TABLE));
    await drop(await ctx.db.query("captureSessions").withIndex("by_client", (q) => q.eq("clientId", client._id)).take(PER_TABLE));
    // What demoScreens.ts adds for the manual's screenshots.
    await drop(await ctx.db.query("invoices").withIndex("by_client_and_issued_at", (q) => q.eq("clientId", client._id)).take(PER_TABLE));
    await drop(await ctx.db.query("apiKeys").withIndex("by_client", (q) => q.eq("clientId", client._id)).take(PER_TABLE));
    await drop(await ctx.db.query("webhookDeliveries").withIndex("by_client", (q) => q.eq("clientId", client._id)).take(PER_TABLE));
    await drop(await ctx.db.query("webhookEndpoints").withIndex("by_client", (q) => q.eq("clientId", client._id)).take(PER_TABLE));
    await drop(await ctx.db.query("amlClearedMatches").withIndex("by_client_and_cleared_at", (q) => q.eq("clientId", client._id)).take(PER_TABLE));
    await drop(await ctx.db.query("retentionPurges").withIndex("by_client_and_requested_at", (q) => q.eq("clientId", client._id)).take(PER_TABLE));
    await drop(await ctx.db.query("livenessRequests").withIndex("by_client", (q) => q.eq("clientId", client._id)).take(PER_TABLE));
    await drop((await ctx.db.query("dataRequests").withIndex("by_received_at").order("desc").take(2000)).filter((row) => row.clientId === client._id));
    const members = await ctx.db.query("clientMembers").withIndex("by_client", (q) => q.eq("clientId", client._id)).take(100);
    for (const member of members) {
      const rows = await ctx.db.query("notifications").withIndex("by_user_and_created_at", (q) => q.eq("userId", member.userId)).take(PER_TABLE);
      await drop(rows.filter((row) => row.clientId === client._id));
    }
    if (removed > 0) return { done: false, removed };
    const settingsRows = await ctx.db.query("clientSettings").withIndex("by_client", (q: any) => q.eq("clientId", client._id)).take(10);
    for (const row of settingsRows) if (row.profile?.logoStorageId) await ctx.storage.delete(row.profile.logoStorageId).catch(() => undefined);
    await drop(settingsRows);
    // Invented team members (demo|…) have profiles only Demo Bank uses.
    for (const member of members.filter((row) => row.userId.startsWith("demo|"))) {
      await drop(await ctx.db.query("userProfiles").withIndex("by_user_id", (q) => q.eq("userId", member.userId)).take(5));
    }
    await drop(members);
    await ctx.db.delete(client._id);
    return { done: true, removed: removed + 1 };
  },
});
