/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aml from "../aml.js";
import type * as amlPersistence from "../amlPersistence.js";
import type * as apiKeys from "../apiKeys.js";
import type * as auditLog from "../auditLog.js";
import type * as clients from "../clients.js";
import type * as complianceReports from "../complianceReports.js";
import type * as creditLedger from "../creditLedger.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as http from "../http.js";
import type * as idp from "../idp.js";
import type * as kyb from "../kyb.js";
import type * as kyi from "../kyi.js";
import type * as lib_amlMatching from "../lib/amlMatching.js";
import type * as lib_awsClients_amlClient from "../lib/awsClients/amlClient.js";
import type * as lib_awsClients_docScanClient from "../lib/awsClients/docScanClient.js";
import type * as lib_awsClients_internalFetch from "../lib/awsClients/internalFetch.js";
import type * as lib_awsClients_iprsClient from "../lib/awsClients/iprsClient.js";
import type * as lib_awsClients_livenessClient from "../lib/awsClients/livenessClient.js";
import type * as lib_credits from "../lib/credits.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_kyc_types from "../lib/kyc-types.js";
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
import type * as reviewQueue from "../reviewQueue.js";
import type * as settings from "../settings.js";
import type * as verifications from "../verifications.js";
import type * as watchlists from "../watchlists.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aml: typeof aml;
  amlPersistence: typeof amlPersistence;
  apiKeys: typeof apiKeys;
  auditLog: typeof auditLog;
  clients: typeof clients;
  complianceReports: typeof complianceReports;
  creditLedger: typeof creditLedger;
  crons: typeof crons;
  dashboard: typeof dashboard;
  http: typeof http;
  idp: typeof idp;
  kyb: typeof kyb;
  kyi: typeof kyi;
  "lib/amlMatching": typeof lib_amlMatching;
  "lib/awsClients/amlClient": typeof lib_awsClients_amlClient;
  "lib/awsClients/docScanClient": typeof lib_awsClients_docScanClient;
  "lib/awsClients/internalFetch": typeof lib_awsClients_internalFetch;
  "lib/awsClients/iprsClient": typeof lib_awsClients_iprsClient;
  "lib/awsClients/livenessClient": typeof lib_awsClients_livenessClient;
  "lib/credits": typeof lib_credits;
  "lib/crypto": typeof lib_crypto;
  "lib/kyc-types": typeof lib_kyc_types;
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
  reviewQueue: typeof reviewQueue;
  settings: typeof settings;
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
