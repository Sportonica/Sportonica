"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteTournamentAnnouncement, postTournamentAnnouncement, updateTournamentAnnouncement } from "@/lib/tournaments/actions";
import { isActionError } from "@/lib/actionError";
import type { TournamentAnnouncement } from "@/lib/tournaments/types";

const inputStyle: React.CSSProperties = {
  padding: "9px 10px", borderRadius: 10, border: "1px solid rgba(242,237,230,0.15)",
  background: "transparent", color: "inherit", fontFamily: "inherit",
};

export default function AnnouncementsTab({ tournamentId, announcements }: {
  tournamentId: string;
  announcements: TournamentAnnouncement[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [rowErr, setRowErr] = useState<string | null>(null);

  function startEdit(a: TournamentAnnouncement) {
    setEditingId(a.id); setEditTitle(a.title); setEditBody(a.body ?? ""); setRowErr(null);
  }

  function saveEdit(id: string) {
    setRowErr(null);
    startTransition(async () => {
      const res = await updateTournamentAnnouncement(id, editTitle, editBody);
      if (isActionError(res)) { setRowErr(res.message); return; }
      setEditingId(null);
      router.refresh();
    });
  }

  function remove(a: TournamentAnnouncement) {
    if (!window.confirm(`Delete "${a.title}"? It disappears from the tournament page. Notifications already sent stay with the captains.`)) return;
    setRowErr(null);
    startTransition(async () => {
      const res = await deleteTournamentAnnouncement(a.id, tournamentId);
      if (isActionError(res)) { setRowErr(res.message); return; }
      router.refresh();
    });
  }

  function post() {
    setErr(null);
    startTransition(async () => {
      const res = await postTournamentAnnouncement(tournamentId, title, body || undefined);
      if (isActionError(res)) { setErr(res.message); return; }
      setTitle(""); setBody("");
      router.refresh();
    });
  }

  return (
    <div className="tc-card">
      <div className="tc-card-t">Announcements</div>
      <div className="tc-card-sub">Posted here and sent as a notification to every confirmed team&apos;s captain.</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "14px 0 20px" }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" style={inputStyle} />
        <textarea
          value={body} onChange={(e) => setBody(e.target.value)} placeholder="Details (optional)" rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
        />
        {err && <div className="tc-err">{err}</div>}
        <button className="tc-btn primary" disabled={pending || !title.trim()} onClick={post} style={{ alignSelf: "flex-start" }}>
          Post announcement
        </button>
      </div>

      {announcements.length === 0 ? (
        <div className="tc-empty">No announcements yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {announcements.map((a) => (
            <div key={a.id} style={{ borderBottom: "1px solid rgba(242,237,230,0.08)", paddingBottom: 12 }}>
              {editingId === a.id ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Title" aria-label="Title" style={inputStyle} />
                  <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} placeholder="Details (optional)" aria-label="Details" rows={3} style={{ ...inputStyle, resize: "vertical" }} />
                  <div className="tc-dim" style={{ fontSize: 11.5 }}>Captains are not notified again about an edit.</div>
                  {rowErr && <div className="tc-err">{rowErr}</div>}
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="tc-btn primary" disabled={pending || !editTitle.trim()} onClick={() => saveEdit(a.id)} style={{ padding: "6px 10px", fontSize: 12 }}>Save</button>
                    <button className="tc-btn" disabled={pending} onClick={() => setEditingId(null)} style={{ padding: "6px 10px", fontSize: 12 }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{a.title}</div>
                  {a.body && <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4, whiteSpace: "pre-wrap" }}>{a.body}</div>}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                    <span className="tc-dim" style={{ fontSize: 11.5 }}>
                      {new Date(a.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kathmandu" })}
                    </span>
                    <button className="tc-btn" disabled={pending} onClick={() => startEdit(a)} style={{ padding: "4px 8px", fontSize: 11.5 }}>Edit</button>
                    <button className="tc-btn" disabled={pending} onClick={() => remove(a)} style={{ padding: "4px 8px", fontSize: 11.5, color: "#ef4444" }}>Delete</button>
                  </div>
                  {rowErr && editingId === null && <div className="tc-err" style={{ marginTop: 6 }}>{rowErr}</div>}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
