/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as apiKeys from "../apiKeys.js";
import type * as auth from "../auth.js";
import type * as creditLedger from "../creditLedger.js";
import type * as http from "../http.js";
import type * as idp from "../idp.js";
import type * as lib_awsClients_amlClient from "../lib/awsClients/amlClient.js";
import type * as lib_awsClients_docScanClient from "../lib/awsClients/docScanClient.js";
import type * as lib_awsClients_internalFetch from "../lib/awsClients/internalFetch.js";
import type * as lib_awsClients_iprsClient from "../lib/awsClients/iprsClient.js";
import type * as lib_awsClients_livenessClient from "../lib/awsClients/livenessClient.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_riskEngine from "../lib/riskEngine.js";
import type * as lib_webhookDispatch from "../lib/webhookDispatch.js";
import type * as verifications from "../verifications.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  apiKeys: typeof apiKeys;
  auth: typeof auth;
  creditLedger: typeof creditLedger;
  http: typeof http;
  idp: typeof idp;
  "lib/awsClients/amlClient": typeof lib_awsClients_amlClient;
  "lib/awsClients/docScanClient": typeof lib_awsClients_docScanClient;
  "lib/awsClients/internalFetch": typeof lib_awsClients_internalFetch;
  "lib/awsClients/iprsClient": typeof lib_awsClients_iprsClient;
  "lib/awsClients/livenessClient": typeof lib_awsClients_livenessClient;
  "lib/crypto": typeof lib_crypto;
  "lib/riskEngine": typeof lib_riskEngine;
  "lib/webhookDispatch": typeof lib_webhookDispatch;
  verifications: typeof verifications;
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

export declare const components: {};
