// Shared fallback for route-level loading.tsx files. Kept dependency-free
// so it stays part of the base bundle and paints immediately.
//
// IMPORTANT: only add a loading.tsx (using this) to a route segment whose
// entire subtree is free of notFound()/redirect() calls that need a real
// HTTP status. A loading.tsx wraps its own page.tsx AND every nested
// child segment in a <Suspense> boundary, which starts streaming (and
// commits a 200) before a deeper notFound()/redirect() can take effect —
// see the removed root src/app/loading.tsx and the investigation that
// led to splitting it up per-section instead.
export default function RouteLoadingSpinner() {
  return (
    <div
      aria-live="polite"
      aria-busy="true"
      style={{
        minHeight: "60vh",
        display: "grid",
        placeItems: "center",
        padding: 40,
      }}
    >
      <span
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          border: "3px solid rgba(0,98,65,0.18)",
          borderTopColor: "#006241",
          display: "block",
          animation: "sptn-spin 0.7s linear infinite",
        }}
      />
      <style>{`@keyframes sptn-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
