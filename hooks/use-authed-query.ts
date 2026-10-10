"use client";

import { type OptionalRestArgsOrSkip, useConvexAuth, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";

/**
 * `useQuery` that waits for the Convex auth handshake. Without this, queries
 * fire before the Auth0 token is attached and the first call fails with an
 * `unauthenticated` ConvexError that crashes the page.
 *
 * Returns `undefined` while auth or the query is loading. Query errors are
 * thrown during render and handled by the nearest error boundary
 * (app/(platform)/error.tsx).
 */
export function useAuthedQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query> | "skip",
): FunctionReturnType<Query> | undefined {
  const { isAuthenticated } = useConvexAuth();
  const restArgs = [isAuthenticated ? args : "skip"] as unknown as OptionalRestArgsOrSkip<Query>;
  return useQuery(query, ...restArgs);
}
