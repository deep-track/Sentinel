"use client";

import { useEffect } from "react";

// Replaces the root layout when it (or a provider in it) throws, so it must
// render its own <html>/<body> and can't rely on app styles or providers.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global] unrecoverable error", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#f8fafc",
          color: "#0f172a",
        }}
      >
        <div
          style={{
            maxWidth: 420,
            padding: 32,
            borderRadius: 16,
            border: "1px solid #e2e8f0",
            background: "#ffffff",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>Sentinel is temporarily unavailable</h1>
          <p style={{ fontSize: 14, color: "#64748b", margin: "0 0 20px" }}>
            An unexpected error stopped the app from loading. Try again in a moment.
          </p>
          {error.digest ? (
            <p style={{ fontSize: 12, color: "#94a3b8", fontFamily: "monospace", margin: "0 0 20px" }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "none",
              background: "#000000",
              color: "#ffffff",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
