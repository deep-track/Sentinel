import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  clientMembers: defineTable({
    clientId: v.id("clients"),
    userId: v.string(), 
    role: v.union(
      v.literal("client_admin"),
      v.literal("compliance_analyst"),
      v.literal("developer"),
      v.literal("viewer"),
    ),
    isActive: v.boolean(),
    invitedBy: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_client", ["clientId"])
    .index("by_user", ["userId"])
    .index("by_client_and_user", ["clientId", "userId"]),

  // Display name and email per Auth0 user id, written by each user for
  // themselves on sign-in (userProfiles.recordMine).
  userProfiles: defineTable({
    userId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    updatedAt: v.number(),
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
    createdAt: v.number(),
  }),

  apiKeys: defineTable({
    clientId: v.id("clients"),
    prefix: v.string(),      
    hashedKey: v.string(),  
    environment: v.union(v.literal("live"), v.literal("test")),
    revoked: v.boolean(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
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
    updatedAt: v.number(),
    updatedBy: v.string(),
  }).index("by_key", ["key"]),

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
    createdAt: v.number(),
  })
    .index("by_client", ["clientId"])
    .index("by_client_created_at", ["clientId", "createdAt"])
    .index("by_verification", ["verificationId"]),

  watchlistSources: defineTable({
    sourceKey: v.union(v.literal("OFAC_SDN"), v.literal("UN_CONSOLIDATED")),
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
    sourceKey: v.union(v.literal("OFAC_SDN"), v.literal("UN_CONSOLIDATED")),
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
    sourceKey: v.union(v.literal("OFAC_SDN"), v.literal("UN_CONSOLIDATED")),
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
      v.literal("FBI_MOST_WANTED"),
      v.literal("OPENSANCTIONS"),
      v.literal("ADVERSE_MEDIA"),
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

  webhookDeliveries: defineTable({
    clientId: v.id("clients"),
    verificationId: v.id("verifications"),
    status: v.union(
      v.literal("pending"),
      v.literal("delivered"),
      v.literal("retrying"),
      v.literal("failed"),
    ),
    attemptCount: v.number(),
    lastAttemptAt: v.optional(v.number()),
    nextRetryAt: v.optional(v.number()),
    lastResponseStatus: v.optional(v.number()),
    payload: v.any(),
    createdAt: v.number(),
  })
    .index("by_client", ["clientId"])
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
});