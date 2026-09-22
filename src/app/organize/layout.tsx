import Link from "next/link";
import "../platform/platform.css";
import "../admin/admin.css";

export const dynamic = "force-dynamic";

// Organizer console — deliberately its own top-nav shell (like /platform)
// rather than /admin's sidebar-console (AdminNav assumes venue operations:
// courts, pricing, staff — none of which apply to an Organizer, who never
// needs to own a venue). Auth/role gating happens per-page (mirrors how
// /admin/tournaments/new already gates on "no venues yet" rather than a
// hard layout-level redirect) since a first-time visitor should land on
// the self-serve "Become an organizer" CTA, not get bounced away from it.
export default function OrganizeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="plt">
      <header className="plt-top">
        <Link href="/organize" className="plt-brand" style={{ textDecoration: "none", color: "inherit" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/mark.png" alt="" className="plt-k" />
          <div>
            <div className="plt-name">Sportonica</div>
            <div className="plt-sub">Organize</div>
          </div>
        </Link>
        <nav className="plt-nav">
          <Link href="/organize">Tournaments</Link>
          <Link href="/organize/partnerships">Venues</Link>
          <Link href="/organize/tournaments/new">+ Tournament</Link>
          <Link href="/discover">↗ App</Link>
        </nav>
      </header>
      <div className="plt-body">{children}</div>
    </div>
  );
}
