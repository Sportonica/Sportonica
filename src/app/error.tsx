"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app error boundary]", error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: "70vh",
        display: "grid",
        placeItems: "center",
        padding: 40,
        textAlign: "center",
      }}
    >
      <div>
        <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--sodium)", marginBottom: 10 }}>
          Something went wrong
        </p>
        <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 8 }}>That didn&apos;t load right</h1>
        <p style={{ fontSize: 14, color: "var(--slate)", marginBottom: 24, maxWidth: 380 }}>
          Give it another try — if it keeps happening, reach us at{" "}
          <a href="mailto:info@sportonica.com" style={{ color: "var(--sodium)" }}>info@sportonica.com</a>.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            padding: "11px 22px",
            borderRadius: 12,
            background: "var(--sodium)",
            color: "#fff",
            fontWeight: 700,
            fontSize: 14,
            border: "none",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
