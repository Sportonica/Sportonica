import Link from "next/link";

export const metadata = { title: "Page not found — Sportonica" };

export default function NotFound() {
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
          404
        </p>
        <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 8 }}>This court&apos;s not on the map</h1>
        <p style={{ fontSize: 14, color: "var(--slate)", marginBottom: 24, maxWidth: 380 }}>
          The page you&apos;re looking for doesn&apos;t exist, or it moved.
        </p>
        <Link
          href="/"
          style={{
            display: "inline-block",
            padding: "11px 22px",
            borderRadius: 12,
            background: "var(--sodium)",
            color: "#fff",
            fontWeight: 700,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          Back to Sportonica
        </Link>
      </div>
    </div>
  );
}
