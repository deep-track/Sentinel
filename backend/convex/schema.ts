import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  dataSettingsValidator,
  notificationSettingsValidator,
  profileSettingsValidator,
  reviewSettingsValidator,
  screeningSettingsValidator,
  securitySettingsValidator,
} from "./lib/clientSettings";

export default defineSchema({
  clientMembers: defineTable({
    clientId: v.id("clients"),
    userId: v.string(), 
    role: v.union(
      v.literal("client_admin"),
      v.literal("compliance_analyst"),
      v.literal("reviewer"),
      v.literal("developer"),
      v.literal("viewer"),
    ),
    isActive: v.boolean(),
    invitedBy: v.optional(v.string()),
    // Review queues this member is assigned cases from by round-robin
    // (lib/clientSettings.ts QUEUES). Absent or empty = every queue.
    queues: v.optional(v.array(v.string())),
    deactivatedAt: v.optional(v.number()),
    deactivatedBy: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_client", ["clientId"])
    .index("by_user", ["userId"])
    .index("by_client_and_user", ["clientId", "userId"]),

  // Pending team invitations (team.ts). The invitee becomes a member the
  // first time they sign in with this verified email (team.acceptMyInvites).
  // The Auth0 invitation email is sent by the portal's server action
  // (app/(platform)/settings/team/actions.ts).
  teamInvites: defineTable({
    clientId: v.id("clients"),
    email: v.string(), // lower-cased
    role: v.union(
      v.literal("client_admin"),
      v.literal("compliance_analyst"),
      v.literal("reviewer"),
      v.literal("developer"),
      v.literal("viewer"),
    ),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("revoked")),
    invitedBy: v.string(),
    invitedByName: v.optional(v.string()),
    auth0InvitationId: v.optional(v.string()),
    emailStatus: v.optional(v.union(v.literal("sent"), v.literal("failed"))),
    createdAt: v.number(),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    acceptedBy: v.optional(v.string()),
    revokedAt: v.optional(v.number()),
    revokedBy: v.optional(v.string()),
  })
    .index("by_client_and_status", ["clientId", "status"])
    .index("by_email_and_status", ["email", "status"]),

  // A client's own settings (lib/clientSettings.ts): one row per client,
  // one optional object per Settings section.
  clientSettings: defineTable({
    clientId: v.id("clients"),
    review: v.optional(reviewSettingsValidator),
    screening: v.optional(screeningSettingsValidator),
    notifications: v.optional(notificationSettingsValidator),
    security: v.optional(securitySettingsValidator),
    data: v.optional(dataSettingsValidator),
    profile: v.optional(profileSettingsValidator),
    // Single sign-on (sso.ts): the client's Auth0 enterprise connection.
    // Secrets live only in Auth0, never here.
    sso: v.optional(
      v.object({
        status: v.union(v.literal("pending"), v.literal("connected")),
        provider: v.union(v.literal("entra_id"), v.literal("google_workspace"), v.literal("saml"), v.literal("oidc")),
        connectionName: v.string(),
        connectionId: v.optional(v.string()),
        domains: v.array(v.string()),
        // Members at these domains must sign in through the connection.
        enforce: v.boolean(),
        // Role given to someone who signs in through SSO without an invite
        // (absent = they need an invite).
        jitRole: v.optional(v.union(v.literal("compliance_analyst"), v.literal("reviewer"), v.literal("developer"), v.literal("viewer"))),
        connectedAt: v.optional(v.number()),
        connectedBy: v.optional(v.string()),
      }),
    ),
    // sso.connectionName when connected, for finding the client on sign-in.
    ssoConnectionName: v.optional(v.string()),
    updatedAt: v.number(),
    updatedBy: v.string(),
  })
    .index("by_client", ["clientId"])
    .index("by_sso_connection", ["ssoConnectionName"]),

  // In-app notifications per user (notifications.ts); emailed too when the
  // event's settings ask for it and email is configured.
  notifications: defineTable({
    clientId: v.id("clients"),
    userId: v.string(),
    event: v.string(),
    title: v.string(),
    body: v.string(),
    link: v.optional(v.string()),
    readAt: v.optional(v.number()),
    emailStatus: v.optional(v.union(v.literal("queued"), v.literal("sent"), v.literal("skipped"), v.literal("failed"))),
    createdAt: v.number(),
  })
    .index("by_user_and_created_at", ["userId", "createdAt"])
    .index("by_user_and_read_at", ["userId", "readAt"]),

  // Display name and email per Auth0 user id, written by each user for
  // themselves on sign-in (userProfiles.recordMine).
  userProfiles: defineTable({
    userId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    updatedAt: v.number(),
    // Last time the user opened the portal (written at most hourly).
    lastSeenAt: v.optional(v.number()),
  }).index("by_user_id", ["userId"]),

  clients: defineTable({
    name: v.string(),
    plan: v.union(
      v.literal("trial"),
      v.literal("starter"),
      v.literal("growth"),
      v.literal("business"),
      v.literal("enterprise"),
    ),
    status: v.union(
      v.literal("active"),
      v.literal("suspended"),
      v.literal("trial_expired"),
    ),
    creditLimit: v.number(), 
    // Running balance maintained by lib/credits.ts. Optional for rows created
    // before it existed; lazily backfilled from the ledger on first use.
    creditBalance: v.optional(v.number()),
    rpmCap: v.number(),      // requests per min cap
    creditThresholdPct: v.number(), // alert fires when credits are low
    webhookUrl: v.optional(v.string()),
    webhookSecret: v.optional(v.string()), //verify a webhook 
    // Currency the client is billed and shown amounts in (lib/pricing.ts).
    // Absent = USD. The ledger is always in credits = US cents.
    billingCurrency: v.optional(v.union(v.literal("USD"), v.literal("KES"))),
    // Webhook events the client receives (absent = all of them).
    webhookEvents: v.optional(v.array(v.string())),
    // Most active members plus pending invites; set by DeepTrack. Absent = no limit.
    seatLimit: v.optional(v.number()),
    // When the low-credit notification last went out; cleared once the
    // balance is topped up above the warning level again.
    lowCreditNotifiedAt: v.optional(v.number()),
    // Self-service trials (signups.ts): when the trial ends, who started it
    // and their email domain (one trial per company domain).
    trialEndsAt: v.optional(v.number()),
    signupSource: v.optional(v.literal("self_service")),
    signupOwner: v.optional(v.string()),
    signupDomain: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_signup_owner", ["signupOwner"])
    .index("by_signup_domain", ["signupDomain"])
    .index("by_plan_and_status", ["plan", "status"]),

  // Sign-up requests from the public /signup page, before the person has an
  // account: the Auth0 invitation is sent to this email, and the trial form
  // is filled in from it after they sign in.
  signupRequests: defineTable({
    email: v.string(), // lower-cased
    name: v.string(),
    company: v.string(),
    country: v.string(),
    status: v.union(v.literal("pending"), v.literal("invited"), v.literal("completed")),
    createdAt: v.number(),
    invitedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_email", ["email"])
    .index("by_created_at", ["createdAt"]),

  apiKeys: defineTable({
    clientId: v.id("clients"),
    prefix: v.string(),      
    hashedKey: v.string(),  
    environment: v.union(v.literal("live"), v.literal("test")),
    revoked: v.boolean(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    // Display name chosen by the client.
    label: v.optional(v.string()),
    // API scopes (apiKeys.ts API_SCOPES). Absent = every scope (keys created
    // before scopes existed).
    scopes: v.optional(v.array(v.string())),
    // A rotated key keeps working until this time, so the client can deploy
    // the new key first.
    expiresAt: v.optional(v.number()),
    rotatedTo: v.optional(v.id("apiKeys")),
    createdBy: v.optional(v.string()),
  })
    .index("by_prefix", ["prefix"])
    .index("by_client", ["clientId"]),

  verifications: defineTable({
    clientId: v.id("clients"),
    type: v.union(
      v.literal("idp"),
      v.literal("kyb"),
      v.literal("aml"),
      v.literal("liveness"),
      v.literal("kyi"), // retired: existing records are read-only
      v.literal("document"), // IDP: identity document or proof of address
    ),
    status: v.union(
      v.literal("queued"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    verdict: v.optional(
      v.union(v.literal("pass"), v.literal("review"), v.literal("reject")),
    ),
    confidence: v.optional(v.number()), // 0-1
    creditsUsed: v.number(),
    input: v.any(),
    result: v.optional(v.any()), // raw provider result payload
    reference: v.string(),       // client-facing id, e.g. "gt_..."
    failureReason: v.optional(v.string()),
    disputeReason: v.optional(v.string()), // client-initiated dispute
    disputedAt: v.optional(v.number()),
    // Personal data removed after the retention period (retention.ts); the
    // row stays as a minimal record (reference, type, verdict, dates).
    purgedAt: v.optional(v.number()),
    retentionPurgeId: v.optional(v.id("retentionPurges")),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_client", ["clientId"])
    .index("by_reference", ["reference"])
    .index("by_client_and_status", ["clientId", "status"])
    .index("by_client_and_type", ["clientId", "type"])
    .index("by_created_at", ["createdAt"])
    .index("by_client_and_created_at", ["clientId", "createdAt"])
    .index("by_client_and_type_and_created_at", ["clientId", "type", "createdAt"])
    .index("by_type_and_created_at", ["type", "createdAt"]),

  livenessRequests: defineTable({
    clientId: v.id("clients"),
    contact: v.string(),
    method: v.union(v.literal("sms"), v.literal("whatsapp"), v.literal("email")),
    status: v.union(v.literal("pending"), v.literal("completed"), v.literal("failed")),
    // sent -> delivered | failed | undelivered (Twilio status callbacks).
    deliveryStatus: v.union(v.literal("pending"), v.literal("sent"), v.literal("delivered"), v.literal("failed"), v.literal("undelivered")),
    providerMessageId: v.optional(v.string()),
    verificationId: v.optional(v.id("verifications")),
    createdAt: v.number(),
    sentAt: v.number(),
    completedAt: v.optional(v.number()),
    failureReason: v.optional(v.string()),
    })
    .index("by_client", ["clientId"])
    .index("by_verification", ["verificationId"])
    .index("by_provider_message", ["providerMessageId"]),
  // Back Office: data subject requests (Kenya Data Protection Act) tracked by
  // the compliance team. `subject` should be a verification reference, not
  // the person's details.
  dataRequests: defineTable({
    requestType: v.union(v.literal("access"), v.literal("erasure"), v.literal("rectification"), v.literal("objection")),
    subject: v.string(),
    clientId: v.optional(v.id("clients")),
    status: v.union(v.literal("open"), v.literal("in_progress"), v.literal("completed"), v.literal("rejected")),
    receivedAt: v.number(),
    dueAt: v.number(),
    notes: v.optional(v.string()),
    createdBy: v.string(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_status_and_due", ["status", "dueAt"])
    .index("by_received_at", ["receivedAt"]),

  // Back Office client health: one row per 4xx/5xx an authenticated API
  // client received (kept 30 days). No request bodies or personal data.
  apiErrors: defineTable({
    clientId: v.id("clients"),
    apiKeyId: v.id("apiKeys"),
    environment: v.union(v.literal("live"), v.literal("test")),
    route: v.string(),
    status: v.number(),
    at: v.number(),
  })
    .index("by_client_and_at", ["clientId", "at"])
    .index("by_at", ["at"]),

  // Back Office pricing: one row (key "default"). Price per credit for each
  // plan; unset prices make the billing screens show credits only.
  billingSettings: defineTable({
    key: v.literal("default"),
    // Legacy (before plan pricing): a flat price per credit. Unused now that
    // credits are US cents; kept optional so existing rows still validate.
    currency: v.optional(v.string()),
    pricePerCredit: v.optional(v.any()),
    // USD → KES rate for clients billed in KES (lib/pricing.ts).
    usdToKes: v.optional(v.number()),
    // Invoices (billing.ts): DeepTrack's details, VAT and how to pay by
    // bank transfer or M-Pesa paybill to the bank.
    seller: v.optional(
      v.object({
        name: v.optional(v.string()),
        address: v.optional(v.string()),
        kraPin: v.optional(v.string()),
        email: v.optional(v.string()),
        vatRatePct: v.optional(v.number()),
        paymentInstructions: v.optional(v.string()),
      }),
    ),
    // Next invoice number per year: DT-<year>-<0001>.
    invoiceYear: v.optional(v.number()),
    invoiceNext: v.optional(v.number()),
    updatedAt: v.number(),
    updatedBy: v.string(),
  }).index("by_key", ["key"]),

  // Invoices: credit top-ups, plan prepayments and other charges. Paying one
  // (Paystack, or marked paid by DeepTrack for a bank / M-Pesa transfer)
  // adds its credits to the ledger once.
  invoices: defineTable({
    clientId: v.id("clients"),
    number: v.string(),
    kind: v.union(v.literal("top_up"), v.literal("plan"), v.literal("other")),
    // A plan prepayment: paying it moves the client to this plan.
    plan: v.optional(v.union(v.literal("starter"), v.literal("growth"), v.literal("business"), v.literal("enterprise"))),
    status: v.union(v.literal("issued"), v.literal("paid"), v.literal("void")),
    currency: v.union(v.literal("USD"), v.literal("KES")),
    lines: v.array(v.object({ description: v.string(), quantity: v.number(), unitPrice: v.number(), amount: v.number() })),
    subtotal: v.number(),
    vatRatePct: v.number(),
    vat: v.number(),
    total: v.number(),
    credits: v.number(), // added when paid
    buyer: v.object({ name: v.string(), address: v.optional(v.string()), kraPin: v.optional(v.string()), email: v.optional(v.string()) }),
    seller: v.object({ name: v.string(), address: v.optional(v.string()), kraPin: v.optional(v.string()), email: v.optional(v.string()), paymentInstructions: v.optional(v.string()) }),
    issuedAt: v.number(),
    dueAt: v.number(),
    createdBy: v.string(),
    automatic: v.optional(v.boolean()),
    paidAt: v.optional(v.number()),
    paymentMethod: v.optional(v.union(v.literal("paystack"), v.literal("bank_transfer"), v.literal("mpesa"), v.literal("other"))),
    paymentReference: v.optional(v.string()),
    markedPaidBy: v.optional(v.string()),
    voidedAt: v.optional(v.number()),
    voidedBy: v.optional(v.string()),
    notes: v.optional(v.string()),
  })
    .index("by_client_and_issued_at", ["clientId", "issuedAt"])
    .index("by_number", ["number"])
    .index("by_status_and_issued_at", ["status", "issuedAt"]),

  // Paystack transactions for invoices.
  payments: defineTable({
    clientId: v.id("clients"),
    invoiceId: v.id("invoices"),
    reference: v.string(),
    status: v.union(v.literal("initialized"), v.literal("success"), v.literal("failed")),
    amount: v.number(), // subunits (cents)
    currency: v.union(v.literal("USD"), v.literal("KES")),
    email: v.string(),
    saveCard: v.boolean(),
    automatic: v.boolean(),
    channel: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    initiatedBy: v.string(),
    createdAt: v.number(),
    settledAt: v.optional(v.number()),
  })
    .index("by_reference", ["reference"])
    .index("by_invoice", ["invoiceId"])
    .index("by_status_and_created_at", ["status", "createdAt"]),

  // Per-client billing options: billing email, the saved card (Paystack
  // authorization, server-side only) and automatic top-up.
  clientBilling: defineTable({
    clientId: v.id("clients"),
    billingEmail: v.optional(v.string()),
    taxPin: v.optional(v.string()), // the client's KRA PIN, shown on invoices
    card: v.optional(
      v.object({
        authorizationCode: v.string(),
        email: v.string(),
        last4: v.optional(v.string()),
        brand: v.optional(v.string()),
        expMonth: v.optional(v.string()),
        expYear: v.optional(v.string()),
        savedAt: v.number(),
      }),
    ),
    autoTopUp: v.optional(v.object({ enabled: v.boolean(), amount: v.number(), thresholdCredits: v.number() })),
    lastAutoTopUpAt: v.optional(v.number()),
    updatedAt: v.number(),
    updatedBy: v.string(),
  }).index("by_client", ["clientId"]),

  // Back Office service health: one row per scheduled probe of an external
  // dependency (every 15 min, kept 7 days).
  serviceHealthChecks: defineTable({
    service: v.union(v.literal("deeptrack_live"), v.literal("opensanctions"), v.literal("internal_api")),
    ok: v.boolean(),
    httpStatus: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    error: v.optional(v.string()),
    checkedAt: v.number(),
  })
    .index("by_service_and_checked_at", ["service", "checkedAt"])
    .index("by_checked_at", ["checkedAt"]),
  creditLedger: defineTable({
    clientId: v.id("clients"),
    verificationId: v.optional(v.id("verifications")),
    type: v.union(
      v.literal("allocation"),
      v.literal("deduction"),
      v.literal("refund"),
      v.literal("adjustment"),
    ),
    amount: v.number(), // positive = added, negative = consumed
    reason: v.string(),
    // Money value of `amount` when the row was written, in the client's
    // billing currency then (lib/pricing.ts). Absent on rows written before
    // currency pricing, whose money value is unknown.
    currency: v.optional(v.union(v.literal("USD"), v.literal("KES"))),
    value: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_client", ["clientId"])
    .index("by_client_created_at", ["clientId", "createdAt"])
    .index("by_verification", ["verificationId"]),

  watchlistSources: defineTable({
    sourceKey: v.union(v.literal("OFAC_SDN"), v.literal("UN_CONSOLIDATED"), v.literal("EU_FSF"), v.literal("UK_SANCTIONS")),
    displayName: v.string(),
    sourceUrl: v.string(),
    cadence: v.union(v.literal("daily"), v.literal("weekly")),
    enabled: v.boolean(),
    currentVersionId: v.optional(v.id("watchlistVersions")),
    lastAttemptedAt: v.optional(v.number()),
    lastSuccessfulAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_source_key", ["sourceKey"]),

  watchlistVersions: defineTable({
    sourceKey: v.union(v.literal("OFAC_SDN"), v.literal("UN_CONSOLIDATED"), v.literal("EU_FSF"), v.literal("UK_SANCTIONS")),
    sourceUrl: v.string(),
    sourceVersion: v.string(),
    contentHash: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("superseded"),
      v.literal("failed"),
    ),
    recordCount: v.number(),
    fetchedAt: v.number(),
    activatedAt: v.optional(v.number()),
    failureReason: v.optional(v.string()),
    supersededAt: v.optional(v.number()),
    // Set once watchlists.purgeWatchlistVersions has deleted the entries.
    purgedAt: v.optional(v.number()),
  })
    .index("by_source_and_status", ["sourceKey", "status"])
    .index("by_source_and_version", ["sourceKey", "sourceVersion"])
    .index("by_status_and_purgedAt", ["status", "purgedAt"]),

  watchlistEntries: defineTable({
    versionId: v.id("watchlistVersions"),
    sourceKey: v.union(v.literal("OFAC_SDN"), v.literal("UN_CONSOLIDATED"), v.literal("EU_FSF"), v.literal("UK_SANCTIONS")),
    sourceRecordId: v.string(),
    entityType: v.union(v.literal("individual"), v.literal("entity"), v.literal("unknown")),
    primaryName: v.string(),
    aliases: v.array(v.string()),
    normalizedNames: v.array(v.string()),
    countries: v.array(v.string()),
    programs: v.array(v.string()),
    identifiers: v.optional(v.any()),
    isActive: v.boolean(),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_version", ["versionId"])
    .index("by_source_record", ["sourceKey", "sourceRecordId"])
    .index("by_source_and_active", ["sourceKey", "isActive"]),

  flaggedEntities: defineTable({
    entityName: v.string(),
    source: v.union(
      v.literal("OFAC_SDN"),
      v.literal("UN_CONSOLIDATED"),
      v.literal("EU_FSF"),
      v.literal("UK_SANCTIONS"),
      v.literal("FBI_MOST_WANTED"),
      v.literal("OPENSANCTIONS"),
      v.literal("ADVERSE_MEDIA"),
      v.literal("KE_PEP"),
    ),
    program: v.string(),
    matchScore: v.number(), // 0-100
    clientId: v.id("clients"),
    verificationId: v.id("verifications"),
    // Set for Sentinel-owned watchlist matches; absent for OpenSanctions.
    watchlistVersionId: v.optional(v.id("watchlistVersions")),
    watchlistEntryId: v.optional(v.id("watchlistEntries")),
    // OpenSanctions entity id, topics and datasets.
    externalId: v.optional(v.string()),
    topics: v.optional(v.array(v.string())),
    datasets: v.optional(v.array(v.string())),
    // AML risk categories of the hit (lib/amlCategories.ts) and, for PEPs,
    // the Class 1–4 tier. Absent on rows created before categories existed.
    categories: v.optional(
      v.array(
        v.union(
          v.literal("sanctions"),
          v.literal("pep"),
          v.literal("special_interest"),
          v.literal("fitness_probity"),
          v.literal("adverse_media"),
          v.literal("insolvency"),
        ),
      ),
    ),
    pepClass: v.optional(v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4))),
    pepStatus: v.optional(v.union(v.literal("current"), v.literal("former"), v.literal("unknown"))),
    matchMethod: v.union(
      v.literal("exact"),
      v.literal("normalized"),
      v.literal("alias"),
      v.literal("fuzzy"),
      v.literal("provider_score"),
      v.literal("ai_classification"),
    ),
    riskLevel: v.union(v.literal("critical"), v.literal("high")),
    matchedCountry: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_client", ["clientId"])
    .index("by_verification", ["verificationId"])
    .index("by_watchlist_entry", ["watchlistEntryId"]),

  // False-positive memory (amlCleared.ts, lib/amlClearedMatches.ts): AML hits
  // a reviewer cleared for a customer, so they aren't raised again for them
  // unless they become more severe. "Forget" sets revokedAt (kept for audit).
  amlClearedMatches: defineTable({
    clientId: v.id("clients"),
    subjectKey: v.string(),
    subjectName: v.string(),
    matchKey: v.string(),
    source: v.string(),
    sourceRecordId: v.string(),
    entityName: v.string(),
    categories: v.array(v.string()),
    pepClass: v.optional(v.number()),
    riskLevel: v.union(v.literal("critical"), v.literal("high")),
    verificationId: v.id("verifications"),
    reviewId: v.id("reviewQueue"),
    clearedBy: v.string(),
    clearedByName: v.optional(v.string()),
    reasonCode: v.optional(v.string()),
    clearedAt: v.number(),
    suppressedCount: v.number(),
    lastSuppressedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    revokedBy: v.optional(v.string()),
  })
    .index("by_client_and_subject", ["clientId", "subjectKey"])
    .index("by_client_and_cleared_at", ["clientId", "clearedAt"]),

  // Ongoing AML monitoring (amlMonitoring.ts, lib/amlMonitoringStore.ts).
  // Each active subject is re-screened daily; `hits` is the baseline from the
  // last complete screening, and only new or more severe hits alert.
  amlMonitoredSubjects: defineTable({
    clientId: v.id("clients"),
    reference: v.string(), // client-facing id, "mon_…"
    status: v.union(v.literal("active"), v.literal("removed")),
    subjectName: v.string(),
    entityType: v.union(v.literal("individual"), v.literal("entity")),
    country: v.optional(v.string()),
    aliases: v.optional(v.array(v.string())),
    dateOfBirth: v.optional(v.string()),
    nationality: v.optional(v.string()),
    idNumber: v.optional(v.string()),
    registrationNumber: v.optional(v.string()),
    jurisdiction: v.optional(v.string()),
    externalRef: v.optional(v.string()), // the client's own customer id
    enrolledVerificationId: v.id("verifications"),
    enrolledBy: v.string(),
    baselineSet: v.boolean(),
    hits: v.array(
      v.object({
        key: v.string(),
        source: v.string(),
        sourceRecordId: v.string(),
        entityName: v.string(),
        categories: v.array(
          v.union(
            v.literal("sanctions"),
            v.literal("pep"),
            v.literal("special_interest"),
            v.literal("fitness_probity"),
            v.literal("adverse_media"),
            v.literal("insolvency"),
          ),
        ),
        pepClass: v.optional(v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4))),
        riskLevel: v.union(v.literal("critical"), v.literal("high")),
      }),
    ),
    screenCount: v.number(),
    alertCount: v.number(),
    lastScreenedAt: v.optional(v.number()),
    lastAlertAt: v.optional(v.number()),
    nextScreenAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    removedAt: v.optional(v.number()),
  })
    .index("by_client_and_status", ["clientId", "status", "createdAt"])
    .index("by_status_and_next_screen", ["status", "nextScreenAt"])
    .index("by_reference", ["reference"])
    .index("by_client_and_external_ref", ["clientId", "externalRef"])
    .index("by_enrolled_verification", ["enrolledVerificationId"]),

  reviewQueue: defineTable({
    verificationId: v.id("verifications"),
    clientId: v.id("clients"),
    triggerType: v.union(
      v.literal("client_dispute"),
      v.literal("auto_escalation"),
      v.literal("internal_flag"),
    ),
    triggerReason: v.string(),
    priority: v.union(v.literal("low"), v.literal("normal"), v.literal("high")),
    status: v.union(
      v.literal("pending"),
      v.literal("in_review"),
      v.literal("resolved"),
    ),
    assignedTo: v.optional(v.string()),
    // Display names captured when the item was assigned / resolved, so the
    // Back Office can show people instead of sign-in IDs.
    assignedToName: v.optional(v.string()),
    assignedAt: v.optional(v.number()),
    resolvedByName: v.optional(v.string()),
    resolutionAction: v.optional(
      v.union(
        v.literal("confirm"),
        v.literal("keep_verdict"),
        v.literal("escalate"),
      ),
    ),
    resolutionNotes: v.optional(v.string()),
    resolvedBy: v.optional(v.string()),
    escalated: v.optional(v.boolean()),
    // ── The client team's own review (clientReviews.ts) ──
    // Category and deadline under the client's rules, set when queued.
    caseCategory: v.optional(v.string()),
    queue: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    clientAssignedTo: v.optional(v.string()),
    clientAssignedToName: v.optional(v.string()),
    clientAssignedAt: v.optional(v.number()),
    // A first decision waiting for a second person (four-eyes).
    recommendation: v.optional(
      v.object({
        action: v.union(v.literal("approve"), v.literal("reject")),
        reasonCode: v.optional(v.string()),
        notes: v.optional(v.string()),
        by: v.string(),
        byName: v.optional(v.string()),
        role: v.string(),
        at: v.number(),
      }),
    ),
    clientEscalatedAt: v.optional(v.number()),
    clientEscalatedBy: v.optional(v.string()),
    overdueNotifiedAt: v.optional(v.number()),
    // Who made the final decision: the client's team or DeepTrack.
    decisionSource: v.optional(v.union(v.literal("client"), v.literal("deeptrack"))),
    reasonCode: v.optional(v.string()),
    approvedBy: v.optional(v.string()),
    approvedByName: v.optional(v.string()),
    // Client disputes: the result disputed and the one the client expects.
    disputedVerdict: v.optional(v.union(v.literal("pass"), v.literal("reject"))),
    expectedVerdict: v.optional(v.union(v.literal("pass"), v.literal("reject"))),
    // AI hit review (aiHitReview.ts): status and Claude's recommendation.
    aiAssessment: v.optional(v.any()),
    // A client dispute the client withdrew (closed without a decision).
    withdrawnAt: v.optional(v.number()),
    withdrawnBy: v.optional(v.string()),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_client_and_status", ["clientId", "status"])
    .index("by_verification", ["verificationId"])
    .index("by_created_at", ["createdAt"])
    .index("by_status_and_created_at", ["status", "createdAt"]),

  feedbackLabels: defineTable({
    verificationId: v.id("verifications"),
    label: v.union(
      v.literal("false_accept"),
      v.literal("false_reject"),
      v.literal("confirmed_correct"),
    ),
    labeledBy: v.string(),
    // reviewers must never confirm below 80% certainty
    certaintyPct: v.number(),
    notes: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_verification", ["verificationId"]),

  auditLog: defineTable({
    actorId: v.string(),      // Convex Auth userId, or api_key_id for client-driven events
    actorType: v.union(v.literal("internal_admin"), v.literal("reviewer"), v.literal("client_api_key"), v.literal("client_user"), v.literal("system")),
    action: v.string(),       // e.g. "verification.created", "client.suspended", "review.confirmed"
    targetType: v.string(),   // e.g. "verification", "client", "apiKey"
    targetId: v.string(),
    clientId: v.optional(v.id("clients")), // scopes the event to a tenant when applicable
    ipAddress: v.optional(v.string()),
    metadata: v.optional(v.any()),
    timestamp: v.number(),
  })
    .index("by_client", ["clientId"])
    .index("by_target", ["targetType", "targetId"])
    .index("by_timestamp", ["timestamp"])
    .index("by_client_and_timestamp", ["clientId", "timestamp"])
    .index("by_action_and_timestamp", ["action", "timestamp"]),

  // Suspicious transaction / activity reports prepared from cases
  // (strReports.ts): the goAML XML is rebuilt from these fields on download.
  // The register is confidential (tipping-off): Admins and Reviewers only.
  strReports: defineTable({
    clientId: v.id("clients"),
    verificationId: v.id("verifications"),
    reviewId: v.optional(v.id("reviewQueue")),
    reportCode: v.union(v.literal("STR"), v.literal("SAR")),
    status: v.union(v.literal("draft"), v.literal("submitted")),
    entityReference: v.string(),
    reason: v.string(),
    action: v.string(),
    indicators: v.array(v.string()),
    transaction: v.optional(
      v.object({
        number: v.string(),
        date: v.number(),
        amount: v.number(),
        description: v.string(),
        transmodeCode: v.optional(v.string()),
        counterpartyName: v.optional(v.string()),
        counterpartyAccount: v.optional(v.string()),
      }),
    ),
    createdBy: v.string(),
    createdByName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    submittedAt: v.optional(v.number()),
    submittedBy: v.optional(v.string()),
    frcReference: v.optional(v.string()),
  })
    .index("by_client_and_created_at", ["clientId", "createdAt"])
    .index("by_verification", ["verificationId"]),

  complianceReports: defineTable({
    reportType: v.literal("weekly_compliance"),
    periodStart: v.number(),
    periodEnd: v.number(),
    generatedAt: v.number(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    verificationCount: v.number(),
    amlVerificationCount: v.number(),
    completedCount: v.number(),
    failedCount: v.number(),
    passCount: v.number(),
    reviewCount: v.number(),
    rejectCount: v.number(),
    reviewQueueCount: v.number(),
    screeningAuditCount: v.number(),
    screeningFailureCount: v.number(),
    exportData: v.any(),
    exportHash: v.string(),
    // Full export JSON in file storage; exportData then holds a small manifest.
    exportStorageId: v.optional(v.id("_storage")),
    // True when a source hit the export row cap, so counts are lower bounds.
    truncated: v.optional(v.boolean()),
    // Back Office sign-off (internal_admin), recorded once.
    signedOffBy: v.optional(v.string()),
    signedOffByName: v.optional(v.string()),
    signedOffAt: v.optional(v.number()),
    signOffNotes: v.optional(v.string()),
    failureReason: v.optional(v.string()),
  })
    .index("by_generated_at", ["generatedAt"])
    .index("by_period", ["periodStart", "periodEnd"]),

  // A client's webhook endpoints (webhooks.ts). Replaces the single
  // clients.webhookUrl / webhookSecret, which are moved here on first use.
  webhookEndpoints: defineTable({
    clientId: v.id("clients"),
    url: v.string(),
    description: v.optional(v.string()),
    secret: v.string(),
    // A rotated secret: deliveries carry its signature in the *-Next headers
    // until it becomes the secret (on activation, or after 24 hours).
    nextSecret: v.optional(v.string()),
    nextSecretCreatedAt: v.optional(v.number()),
    // Event names (lib/webhookDispatch.ts WEBHOOK_EVENT_TYPES).
    events: v.array(v.string()),
    // Products whose checks are sent (absent = all).
    products: v.optional(v.array(v.string())),
    // Which checks: live keys and the portal, test keys, or both.
    environment: v.union(v.literal("live"), v.literal("test"), v.literal("all")),
    headers: v.optional(v.array(v.object({ name: v.string(), value: v.string() }))),
    status: v.union(v.literal("active"), v.literal("paused")),
    pausedAt: v.optional(v.number()),
    pausedReason: v.optional(v.string()),
    consecutiveFailures: v.number(),
    createdAt: v.number(),
    createdBy: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_client", ["clientId"]),

  webhookDeliveries: defineTable({
    clientId: v.id("clients"),
    // Absent for events not about a check (test events, low credits).
    verificationId: v.optional(v.id("verifications")),
    // Absent on deliveries made before endpoints existed.
    endpointId: v.optional(v.id("webhookEndpoints")),
    event: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("delivered"),
      v.literal("retrying"),
      v.literal("failed"),
      // Held while its endpoint is paused; sent again when it resumes.
      v.literal("paused"),
    ),
    attemptCount: v.number(),
    lastAttemptAt: v.optional(v.number()),
    nextRetryAt: v.optional(v.number()),
    lastResponseStatus: v.optional(v.number()),
    lastError: v.optional(v.string()),
    lastLatencyMs: v.optional(v.number()),
    // Each attempt (latest 10): when, status code or error, and timing.
    attempts: v.optional(
      v.array(
        v.object({
          at: v.number(),
          statusCode: v.optional(v.number()),
          error: v.optional(v.string()),
          latencyMs: v.optional(v.number()),
        }),
      ),
    ),
    test: v.optional(v.boolean()),
    payload: v.any(),
    createdAt: v.number(),
  })
    .index("by_client", ["clientId"])
    .index("by_verification", ["verificationId"])
    .index("by_endpoint", ["endpointId"])
    .index("by_status_and_retry", ["status", "nextRetryAt"]),

  kyiRecords: defineTable({
  verificationId: v.id("verifications"),
  clientId: v.id("clients"),

  // Investor profile
  firstName: v.string(),
  lastName: v.string(),
  email: v.string(),
  phone: v.optional(v.string()),
  nationality: v.optional(v.string()),
  countryOfResidence: v.optional(v.string()),
  dateOfBirth: v.string(),

  // Classification
  investorType: v.union(
    v.literal("individual"), v.literal("joint"), v.literal("corporate"),
    v.literal("fund"), v.literal("trust"), v.literal("institutional"),
  ),
  accreditationStatus: v.union(
    v.literal("accredited"), v.literal("qualified"),
    v.literal("institutional"), v.literal("retail"),
  ),
  sourceOfFunds: v.union(
    v.literal("employment"), v.literal("business"), v.literal("investments"),
    v.literal("inheritance"), v.literal("property"), v.literal("savings"), v.literal("other"),
  ),
  netWorthRange: v.optional(v.union(
    v.literal("under_100k"), v.literal("100k_500k"), v.literal("500k_1m"),
    v.literal("1m_5m"), v.literal("above_5m"),
  )),
  investmentAmount: v.optional(v.number()),
  investmentCurrency: v.optional(v.string()),

  // PEP declaration
  isPEP: v.boolean(),
  pepDetails: v.optional(v.string()),

  // Identity verification inputs
  governmentIdType: v.union(v.literal("passport"), v.literal("national_id"), v.literal("driving_license")),
  governmentIdFrontUrl: v.string(),
  governmentIdBackUrl: v.optional(v.string()),
  selfieUrl: v.string(),

  // Financial documents
  bankStatementUrl: v.string(),
  proofOfAddressUrl: v.string(),
  proofOfNetWorthUrl: v.optional(v.string()),
  accreditationLetterUrl: v.optional(v.string()),
  sourceOfFundsDocUrl: v.optional(v.string()),
  corporateDocUrl: v.optional(v.string()),

  createdAt: v.number(),
})
  .index("by_verification", ["verificationId"])
  .index("by_client", ["clientId"]),

kybDirectors: defineTable({
  kybVerificationId: v.id("verifications"), // parent KYB verification
  clientId: v.id("clients"),
  firstName: v.string(),
  lastName: v.string(),
  email: v.string(),
  position: v.string(),
  shareholding: v.optional(v.string()),
  dateOfBirth: v.string(),
  idNumber: v.string(),
  idpVerificationId: v.optional(v.id("verifications")), // linked IDP sub-check
  status: v.union(v.literal("pending"), v.literal("verified"), v.literal("failed")),
  createdAt: v.number(),
})
  .index("by_kyb_verification", ["kybVerificationId"]),

  // Removal of personal data past a client's retention period: requested by
  // one Admin, approved by another (or DeepTrack), then run in batches.
  retentionPurges: defineTable({
    clientId: v.id("clients"),
    status: v.union(v.literal("pending_approval"), v.literal("running"), v.literal("completed"), v.literal("cancelled")),
    retentionMonths: v.number(),
    cutoff: v.number(), // checks created before this
    estimated: v.number(),
    estimateCapped: v.boolean(),
    requestedBy: v.string(),
    requestedByName: v.optional(v.string()),
    requestedAt: v.number(),
    approvedBy: v.optional(v.string()),
    approvedByName: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    cancelledBy: v.optional(v.string()),
    cancelledAt: v.optional(v.number()),
    cursor: v.optional(v.number()),
    purged: v.number(),
    held: v.number(),
    holds: v.object({ openCase: v.number(), monitoring: v.number(), str: v.number(), unfinished: v.number() }),
    relatedRemoved: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_client_and_requested_at", ["clientId", "requestedAt"])
    .index("by_status", ["status"]),

  // Sentinel's Kenyan PEP register (pepRegister.ts), curated by DeepTrack
  // from Kenya Gazette notices, imports and manual entries.
  pepRegister: defineTable({
    fullName: v.string(),
    aliases: v.array(v.string()),
    position: v.string(),
    organisation: v.optional(v.string()),
    level: v.union(v.literal("national_executive"), v.literal("parliament"), v.literal("judiciary"), v.literal("constitutional_office"), v.literal("security"), v.literal("diplomatic"), v.literal("county_executive"), v.literal("county_government"), v.literal("state_corporation"), v.literal("political_party"), v.literal("family_associate")),
    county: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    birthDate: v.optional(v.string()),
    relatedTo: v.optional(v.string()),
    source: v.union(v.literal("gazette"), v.literal("import"), v.literal("manual")),
    sourceRef: v.optional(v.string()),
    active: v.boolean(),
    addedBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_active", ["active"])
    .index("by_full_name", ["fullName"]),

  // Kenya Gazette issues uploaded to the PEP register and what was found in
  // them, waiting for DeepTrack to approve.
  gazetteImports: defineTable({
    label: v.string(),
    storageId: v.optional(v.id("_storage")),
    status: v.union(v.literal("reading"), v.literal("ready"), v.literal("failed"), v.literal("approved")),
    proposals: v.optional(v.any()),
    error: v.optional(v.string()),
    uploadedBy: v.string(),
    createdAt: v.number(),
    approvedAt: v.optional(v.number()),
    approvedCount: v.optional(v.number()),
  }).index("by_created_at", ["createdAt"]),

  // Kenya BRS lookups through MetaMap, which may answer at the callback URL.
  // Only the SHA-256 of the callback token is stored.
  kybRegistryLookups: defineTable({
    verificationId: v.id("verifications"),
    tokenHash: v.string(),
    status: v.union(v.literal("pending"), v.literal("received")),
    response: v.optional(v.any()),
    requestedAt: v.number(),
    receivedAt: v.optional(v.number()),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_verification", ["verificationId"]),
});