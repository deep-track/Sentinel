/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as aml from "../aml.js";
import type * as amlMonitoring from "../amlMonitoring.js";
import type * as amlPersistence from "../amlPersistence.js";
import type * as amlReport from "../amlReport.js";
import type * as apiKeys from "../apiKeys.js";
import type * as auditLog from "../auditLog.js";
import type * as backOfficeBilling from "../backOfficeBilling.js";
import type * as backOfficeClients from "../backOfficeClients.js";
import type * as backOfficeCompliance from "../backOfficeCompliance.js";
import type * as backOfficeHealth from "../backOfficeHealth.js";
import type * as backOfficeQuality from "../backOfficeQuality.js";
import type * as backOfficeReviews from "../backOfficeReviews.js";
import type * as clientReviews from "../clientReviews.js";
import type * as clients from "../clients.js";
import type * as complianceReports from "../complianceReports.js";
import type * as creditLedger from "../creditLedger.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as documents from "../documents.js";
import type * as documentsNode from "../documentsNode.js";
import type * as http from "../http.js";
import type * as idp from "../idp.js";
import type * as kyb from "../kyb.js";
import type * as kyi from "../kyi.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_adverseMedia from "../lib/adverseMedia.js";
import type * as lib_africasTalking from "../lib/africasTalking.js";
import type * as lib_amlCategories from "../lib/amlCategories.js";
import type * as lib_amlMatching from "../lib/amlMatching.js";
import type * as lib_amlMonitoringStore from "../lib/amlMonitoringStore.js";
import type * as lib_awsClients_amlClient from "../lib/awsClients/amlClient.js";
import type * as lib_awsClients_docScanClient from "../lib/awsClients/docScanClient.js";
import type * as lib_awsClients_faceCheckClient from "../lib/awsClients/faceCheckClient.js";
import type * as lib_awsClients_internalFetch from "../lib/awsClients/internalFetch.js";
import type * as lib_awsClients_iprsClient from "../lib/awsClients/iprsClient.js";
import type * as lib_awsClients_livenessClient from "../lib/awsClients/livenessClient.js";
import type * as lib_c2paResolution from "../lib/c2paResolution.js";
import type * as lib_clientSettings from "../lib/clientSettings.js";
import type * as lib_credits from "../lib/credits.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_deeptrackLive from "../lib/deeptrackLive.js";
import type * as lib_documentChecks from "../lib/documentChecks.js";
import type * as lib_documentPipeline from "../lib/documentPipeline.js";
import type * as lib_documentVision from "../lib/documentVision.js";
import type * as lib_goaml from "../lib/goaml.js";
import type * as lib_openSanctions from "../lib/openSanctions.js";
import type * as lib_pricing from "../lib/pricing.js";
import type * as lib_rateLimits from "../lib/rateLimits.js";
import type * as lib_rbac from "../lib/rbac.js";
import type * as lib_riskEngine from "../lib/riskEngine.js";
import type * as lib_twilio from "../lib/twilio.js";
import type * as lib_urlSafety from "../lib/urlSafety.js";
import type * as lib_verificationTypes from "../lib/verificationTypes.js";
import type * as lib_watchlistParsers from "../lib/watchlistParsers.js";
import type * as lib_webhookDispatch from "../lib/webhookDispatch.js";
import type * as liveness from "../liveness.js";
import type * as memberships from "../memberships.js";
import type * as monitoring from "../monitoring.js";
import type * as notifications from "../notifications.js";
import type * as orgSettings from "../orgSettings.js";
import type * as portal from "../portal.js";
import type * as regulatorPack from "../regulatorPack.js";
import type * as reviewQueue from "../reviewQueue.js";
import type * as settings from "../settings.js";
import type * as strReports from "../strReports.js";
import type * as team from "../team.js";
import type * as userProfiles from "../userProfiles.js";
import type * as verifications from "../verifications.js";
import type * as watchlists from "../watchlists.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  aml: typeof aml;
  amlMonitoring: typeof amlMonitoring;
  amlPersistence: typeof amlPersistence;
  amlReport: typeof amlReport;
  apiKeys: typeof apiKeys;
  auditLog: typeof auditLog;
  backOfficeBilling: typeof backOfficeBilling;
  backOfficeClients: typeof backOfficeClients;
  backOfficeCompliance: typeof backOfficeCompliance;
  backOfficeHealth: typeof backOfficeHealth;
  backOfficeQuality: typeof backOfficeQuality;
  backOfficeReviews: typeof backOfficeReviews;
  clientReviews: typeof clientReviews;
  clients: typeof clients;
  complianceReports: typeof complianceReports;
  creditLedger: typeof creditLedger;
  crons: typeof crons;
  dashboard: typeof dashboard;
  documents: typeof documents;
  documentsNode: typeof documentsNode;
  http: typeof http;
  idp: typeof idp;
  kyb: typeof kyb;
  kyi: typeof kyi;
  "lib/access": typeof lib_access;
  "lib/adverseMedia": typeof lib_adverseMedia;
  "lib/africasTalking": typeof lib_africasTalking;
  "lib/amlCategories": typeof lib_amlCategories;
  "lib/amlMatching": typeof lib_amlMatching;
  "lib/amlMonitoringStore": typeof lib_amlMonitoringStore;
  "lib/awsClients/amlClient": typeof lib_awsClients_amlClient;
  "lib/awsClients/docScanClient": typeof lib_awsClients_docScanClient;
  "lib/awsClients/faceCheckClient": typeof lib_awsClients_faceCheckClient;
  "lib/awsClients/internalFetch": typeof lib_awsClients_internalFetch;
  "lib/awsClients/iprsClient": typeof lib_awsClients_iprsClient;
  "lib/awsClients/livenessClient": typeof lib_awsClients_livenessClient;
  "lib/c2paResolution": typeof lib_c2paResolution;
  "lib/clientSettings": typeof lib_clientSettings;
  "lib/credits": typeof lib_credits;
  "lib/crypto": typeof lib_crypto;
  "lib/deeptrackLive": typeof lib_deeptrackLive;
  "lib/documentChecks": typeof lib_documentChecks;
  "lib/documentPipeline": typeof lib_documentPipeline;
  "lib/documentVision": typeof lib_documentVision;
  "lib/goaml": typeof lib_goaml;
  "lib/openSanctions": typeof lib_openSanctions;
  "lib/pricing": typeof lib_pricing;
  "lib/rateLimits": typeof lib_rateLimits;
  "lib/rbac": typeof lib_rbac;
  "lib/riskEngine": typeof lib_riskEngine;
  "lib/twilio": typeof lib_twilio;
  "lib/urlSafety": typeof lib_urlSafety;
  "lib/verificationTypes": typeof lib_verificationTypes;
  "lib/watchlistParsers": typeof lib_watchlistParsers;
  "lib/webhookDispatch": typeof lib_webhookDispatch;
  liveness: typeof liveness;
  memberships: typeof memberships;
  monitoring: typeof monitoring;
  notifications: typeof notifications;
  orgSettings: typeof orgSettings;
  portal: typeof portal;
  regulatorPack: typeof regulatorPack;
  reviewQueue: typeof reviewQueue;
  settings: typeof settings;
  strReports: typeof strReports;
  team: typeof team;
  userProfiles: typeof userProfiles;
  verifications: typeof verifications;
  watchlists: typeof watchlists;
  webhooks: typeof webhooks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
