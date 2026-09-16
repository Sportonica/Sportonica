import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import "../../p/profile.css";
import "../../(play)/play.css";
import NotificationsPage from "../../(play)/notifications/page";

const SECTIONS: Record<string, { title: string; body: string }> = {
  preferences: {
    title: "Preferences",
    body: "Preferred playing times, locations, and discovery settings are on the way. You can already set the sports you play from Edit Profile.",
  },
  privacy: {
    title: "Privacy",
    body: "More granular privacy controls (blocked users, contact visibility) are on the way. You can already switch your player card between public and private from Edit Profile.",
  },
  help: {
    title: "Help & Support",
    body: "A dedicated help centre is on the way. For now, reach out to the Sportonica team directly if you run into an issue.",
  },
};

export async function generateMetadata({
  searchParams,
}: { searchParams: Promise<{ section?: string }> }): Promise<Metadata> {
  const { section } = await searchParams;
  if (section === "notifications") return { title: "Notifications — Sportonica" };
  const title = (section && SECTIONS[section]?.title) || "Coming soon";
  return { title: `${title} — Sportonica` };
}

export default async function ComingSoonPage({
  searchParams,
}: { searchParams: Promise<{ section?: string }> }) {
  const { section } = await searchParams;

  if (section === "notifications") return <NotificationsPage />;

  const content = (section && SECTIONS[section]) || {
    title: "Coming soon",
    body: "This section is on the way.",
  };

  return (
    <div className="pf">
      <div className="pf-wrap" style={{ maxWidth: 640 }}>
        <Link href="/profile" className="pf-back"><ArrowLeft size={15} /> Profile</Link>
        <h1 className="pf-hub-name" style={{ marginTop: 18 }}>{content.title}</h1>
        <p className="pf-lede" style={{ marginTop: 16 }}>{content.body}</p>
      </div>
    </div>
  );
}
