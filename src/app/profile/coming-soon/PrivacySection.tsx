import Link from "next/link";
import { ArrowLeft, ShieldOff } from "lucide-react";
import { listBlockedUsers } from "@/lib/blocking/queries";
import BlockButton from "@/components/BlockButton";
import "../../p/profile.css";

export default async function PrivacySection() {
  const blocked = await listBlockedUsers();

  return (
    <div className="pf">
      <div className="pf-wrap" style={{ maxWidth: 640 }}>
        <Link href="/profile" className="pf-back"><ArrowLeft size={15} /> Profile</Link>
        <h1 className="pf-hub-name" style={{ marginTop: 18 }}>Privacy</h1>
        <p className="pf-lede" style={{ marginTop: 16 }}>
          You can switch your player card between public and private from Edit Profile.
          More granular contact-visibility controls are on the way.
        </p>

        <h2 style={{ fontSize: 15, fontWeight: 800, marginTop: 32, marginBottom: 4 }}>Blocked users</h2>
        <p style={{ fontSize: 13, opacity: 0.65, marginBottom: 16 }}>
          They can&apos;t message you or send a friend request, and won&apos;t be told they&apos;re blocked.
        </p>

        {blocked.length === 0 ? (
          <div style={{ fontSize: 13.5, opacity: 0.6, padding: "20px 0" }}>
            <ShieldOff size={18} style={{ opacity: 0.5, marginBottom: 8 }} />
            <div>You haven&apos;t blocked anyone.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {blocked.map((p) => {
              const name = p.full_name ?? p.username ?? "Player";
              return (
                <div key={p.id} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
                  border: "1px solid var(--border-line)", borderRadius: 12,
                }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "linear-gradient(150deg,#006241,#1e3932)", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 800, color: "#fff" }}>
                    {p.avatar_url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={p.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600 }}>{name}</div>
                  <BlockButton profileId={p.id} initialBlocked name={name} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
