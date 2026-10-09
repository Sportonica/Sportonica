"use client";

import { useState } from "react";
import { addStallScore, removeStallScore, type StallScore } from "@/lib/games/actions";
import type { StallGame } from "@/lib/games/games";

const field: React.CSSProperties = { font: "inherit", fontSize: 16, padding: "11px 12px", borderRadius: 10, border: "1px solid rgba(127,127,127,.35)", background: "transparent", color: "inherit", width: "100%" };
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function GameScores({ game, initial }: { game: StallGame; initial: StallScore[] }) {
  const [scores, setScores] = useState(initial);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [count, setCount] = useState("");
  const [note, setNote] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // a player who has played before: their name fills in from the phone
  const known = phone.length === 10 ? scores.find((s) => s.phone === phone) : undefined;
  const best = known ? Math.max(...scores.filter((s) => s.phone === phone).map((s) => s.score)) : null;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const res = await addStallScore({ game: game.key, name: name || known?.full_name || "", phone, score: Number(count), note, consent: agreed });
      if ("message" in res) setMsg({ ok: false, text: res.message });
      else {
        setScores((all) => [res.score, ...all]);
        setMsg({ ok: true, text: `Saved: ${res.score.full_name}, ${res.score.score} ${game.unit}.` });
        setName(""); setPhone(""); setCount(""); setNote(""); setAgreed(false);
      }
    } catch { setMsg({ ok: false, text: "No connection. Try again." }); }
    setBusy(false);
  };

  const remove = async (s: StallScore) => {
    if (!window.confirm(`Remove ${s.full_name}'s ${s.score} ${game.unit}? It comes off the leaderboard.`)) return;
    const res = await removeStallScore(s.id);
    if ("message" in res) setMsg({ ok: false, text: res.message });
    else setScores((all) => all.filter((x) => x.id !== s.id));
  };

  return (
    <div style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", alignItems: "start" }}>
      <form onSubmit={add} noValidate style={{ display: "grid", gap: 12, padding: 18, borderRadius: 16, border: "1px solid rgba(127,127,127,.25)" }}>
        <div style={{ fontWeight: 800, fontSize: 17 }}>{game.title}: {game.rule.toLowerCase()}</div>
        <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>Phone number
          <input style={field} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" type="tel" placeholder="98XXXXXXXX" autoComplete="off" />
        </label>
        {known ? <div style={{ fontSize: 13, opacity: 0.75 }}>Played before as {known.full_name}, best {best} {game.unit}.</div> : null}
        <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>Full name
          <input style={field} value={name} onChange={(e) => setName(e.target.value)} placeholder={known?.full_name ?? ""} maxLength={80} autoComplete="off" />
        </label>
        <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>Number of {game.unit}
          <input style={{ ...field, fontSize: 28, fontWeight: 800 }} value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="0" />
        </label>
        <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>Note (optional)
          <input style={field} value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="Second try" />
        </label>
        <label style={{ display: "flex", gap: 10, fontSize: 13, lineHeight: 1.45, alignItems: "flex-start" }}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 3, width: 18, height: 18, flex: "none" }} />
          <span>I read this to the player and they agreed: &quot;Sportonica may show your first name and score on the leaderboard and use your number to contact you about prizes.&quot;</span>
        </label>
        {msg ? <div style={{ fontSize: 14, fontWeight: 600, color: msg.ok ? "#14b8a6" : "#ef4444" }}>{msg.text}</div> : null}
        <button type="submit" disabled={busy || count === ""}
          style={{ font: "inherit", fontSize: 16, fontWeight: 800, padding: 14, borderRadius: 12, border: 0, background: "#ffd23f", color: "#1e1b4b", cursor: "pointer", opacity: busy || count === "" ? 0.6 : 1 }}>
          {busy ? "Saving…" : "Add score"}
        </button>
      </form>

      <div>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 10 }}>Recent scores ({scores.length})</div>
        {scores.length ? (
          <div style={{ display: "grid", gap: 6 }}>
            {scores.slice(0, 100).map((s) => (
              <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, alignItems: "center", padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(127,127,127,.2)", fontSize: 14 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{s.full_name}</div>
                  <div style={{ fontSize: 12.5, opacity: 0.65 }}>{s.phone} · {when(s.created_at)}{s.note ? ` · ${s.note}` : ""}</div>
                </div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>{s.score}</div>
                <button type="button" onClick={() => void remove(s)} style={{ font: "inherit", fontSize: 12.5, background: "none", border: 0, color: "#ff6f61", cursor: "pointer" }}>Remove</button>
              </div>
            ))}
          </div>
        ) : <p style={{ opacity: 0.6, fontSize: 14 }}>No scores yet.</p>}
      </div>
    </div>
  );
}
