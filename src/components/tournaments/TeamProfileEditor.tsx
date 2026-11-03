"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { adminUpdateTeamProfile, setTeamGroup, uploadTeamLogo } from "@/lib/tournaments/actions";
import { isActionError } from "@/lib/actionError";
import type { TournamentTeam } from "@/lib/tournaments/types";

const input: React.CSSProperties = {
  padding: "9px 10px", borderRadius: 10, border: "1px solid rgba(242,237,230,0.15)",
  background: "transparent", color: "inherit", fontFamily: "inherit", width: "100%",
};

const FIELDS = [
  ["club_name", "Club name"],
  ["club_address", "Club address"],
  ["contact_person_name", "Contact person"],
  ["contact_phone", "Contact phone"],
  ["contact_email", "Contact email"],
] as const;
type Key = (typeof FIELDS)[number][0];

/**
 * The organiser's edit of a team's profile, any time: club, address,
 * contact, logo and (for group formats) the group. Every field is optional.
 */
export default function TeamProfileEditor({ team, showGroup, groups, onChanged }: {
  team: TournamentTeam;
  showGroup: boolean;
  /** group names already in use, offered as suggestions */
  groups: string[];
  onChanged: () => void;
}) {
  const [saved, setSaved] = useState(team);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<Key, string>>(() => fromTeam(team));
  const [group, setGroup] = useState(team.group_name ?? "");
  const [logo, setLogo] = useState(team.logo_url ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setValues(fromTeam(saved)); setGroup(saved.group_name ?? ""); setLogo(saved.logo_url ?? ""); setErr(null); setOpen(false);
  }

  function pickLogo(file: File | undefined) {
    if (!file) return;
    setErr(null);
    startTransition(async () => {
      const url = await uploadTeamLogo(file);
      if (isActionError(url)) { setErr(url.message); return; }
      setLogo(url);
    });
  }

  function save() {
    setErr(null);
    startTransition(async () => {
      const res = await adminUpdateTeamProfile(saved.id, { ...values, logo_url: logo });
      if (isActionError(res)) { setErr(res.message); return; }
      let next = res;
      if (showGroup && (group.trim() || null) !== (saved.group_name ?? null)) {
        const g = await setTeamGroup(saved.id, group.trim() || null);
        if (isActionError(g)) { setSaved(next); setErr(`Details saved, but the group was not: ${g.message}`); onChanged(); return; }
        next = g;
      }
      setSaved(next);
      setOpen(false);
      onChanged();
    });
  }

  if (!open) {
    const summary = [saved.club_name, saved.contact_person_name, saved.contact_phone, showGroup && saved.group_name ? `Group ${saved.group_name}` : null].filter(Boolean).join(" · ");
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 16, fontSize: 12.5 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {saved.logo_url ? <img src={saved.logo_url} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: "cover", flex: "none" }} /> : null}
          <span className="tc-dim" style={summary ? undefined : { fontStyle: "italic" }}>{summary || "No club or contact details"}</span>
        </span>
        <button className="tc-btn" style={{ padding: "5px 8px", fontSize: 11.5, flex: "none" }} onClick={() => setOpen(true)}>
          <Pencil size={12} /> Team details
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10, borderRadius: 10, background: "rgba(0,98,65,0.06)", marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 12.5 }}>Team details (all optional)</div>
      {FIELDS.map(([k, label]) => (
        <input key={k} aria-label={label} placeholder={label} value={values[k]} type={k === "contact_email" ? "email" : "text"}
          onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} style={input} />
      ))}
      {showGroup ? (
        <>
          <input aria-label="Group" placeholder="Group (for example A)" list="tc-team-groups" value={group} maxLength={40}
            onChange={(e) => setGroup(e.target.value)} style={input} />
          <datalist id="tc-team-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
          <div className="tc-dim" style={{ fontSize: 11.5 }}>Moving a team changes the tables. Fixtures already made keep their group: change those in Fixtures.</div>
        </>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {logo ? <img src={logo} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover" }} /> : <span className="tc-dim" style={{ fontSize: 12 }}>No logo</span>}
        <label className="tc-btn" style={{ padding: "6px 10px", fontSize: 12, cursor: "pointer" }}>
          {logo ? "Change logo" : "Upload logo"}
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={pending} onChange={(e) => pickLogo(e.target.files?.[0])} />
        </label>
        {logo ? <button className="tc-btn" style={{ padding: "6px 10px", fontSize: 12 }} disabled={pending} onClick={() => setLogo("")}>Remove logo</button> : null}
      </div>
      {err ? <div className="tc-err">{err}</div> : null}
      <div style={{ display: "flex", gap: 6 }}>
        <button className="tc-btn primary" style={{ padding: "6px 10px", fontSize: 12 }} disabled={pending} onClick={save}>{pending ? "Saving…" : "Save"}</button>
        <button className="tc-btn" style={{ padding: "6px 10px", fontSize: 12 }} disabled={pending} onClick={reset}>Cancel</button>
      </div>
    </div>
  );
}

function fromTeam(t: TournamentTeam): Record<Key, string> {
  return {
    club_name: t.club_name ?? "", club_address: t.club_address ?? "", contact_person_name: t.contact_person_name ?? "",
    contact_phone: t.contact_phone ?? "", contact_email: t.contact_email ?? "",
  };
}
