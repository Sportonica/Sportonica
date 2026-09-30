"use client";

// Where a scorer starts: pick the fixture (or set up the race) to score.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getRuleDefaults, openMatchContest, openSwimRace, saveScoringRules } from "@/lib/intelligence/actions";
import { isActionError } from "@/lib/actionError";
import type { SportKey } from "@/lib/intelligence/core/types";
import { ROUNDS, STROKES, type SwimEntry } from "@/lib/intelligence/sports/swimming";
import type { ContestView } from "@/lib/intelligence/types";
import type { TournamentMatch } from "@/lib/tournaments/types";
import { StatusPill } from "./views";
import "./intelligence.css";

export interface HubTeam { id: string; name: string; players: { id: string; name: string; userId: string | null }[] }

const label = (key: string): string => key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

export default function ScorerHub({ tournamentId, tournamentName, sportName, sport, matches, teams, contests, rules }: {
  tournamentId: string; tournamentName: string; sportName: string; sport: SportKey | null;
  matches: TournamentMatch[]; teams: HubTeam[]; contests: ContestView[]; rules: Record<string, unknown> | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.name ?? "To be decided";
  const byMatch = new Map(contests.filter((c) => c.matchId).map((c) => [c.matchId!, c]));

  const openMatch = (matchId: string) => start(async () => {
    const res = await openMatchContest(matchId);
    if (isActionError(res)) setError(res.message);
    else router.push(`/tournaments/${tournamentId}/score/${res.id}`);
  });

  return (
    <div className="si">
      <div className="si-wrap si-grid">
        <div>
          <Link href={`/tournaments/${tournamentId}`} className="si-back"><ChevronLeft size={16} /> {tournamentName}</Link>
          <h1 className="si-h1">Live scoring</h1>
          <p className="si-sub">{sportName}. Every tap is recorded as an event, so the score, statistics and analytics can always be rebuilt and corrected.</p>
        </div>
        {error ? <div className="si-error" role="alert">{error}</div> : null}

        {!sport ? (
          <div className="si-info">{sportName} matches are scored from the Fixtures tab of the tournament console. Event-based live scoring covers basketball, pickleball, cricket, volleyball, badminton and swimming.</div>
        ) : sport === "swimming" ? (
          <>
            <RaceForm tournamentId={tournamentId} teams={teams} onError={setError} />
            <div className="si-card">
              <h2 className="si-h2">Races</h2>
              {contests.length ? contests.map((c) => (
                <div key={c.id} className="si-row" style={{ justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--si-line)" }}>
                  <span style={{ fontWeight: 700 }}>{c.label}</span>
                  <span className="si-row"><StatusPill status={c.status} /><Link className="si-btn small primary" href={`/tournaments/${tournamentId}/score/${c.id}`}>Score</Link></span>
                </div>
              )) : <div className="si-muted">No races yet. Set one up above.</div>}
            </div>
          </>
        ) : (
          <>
            {rules ? <RulesForm tournamentId={tournamentId} sport={sport} initial={rules} onError={setError} /> : null}
            <div className="si-card">
              <h2 className="si-h2">Fixtures</h2>
              {matches.length ? matches.map((m) => {
                const c = byMatch.get(m.id);
                const ready = !!m.team_a_id && !!m.team_b_id;
                return (
                  <div key={m.id} className="si-row" style={{ justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--si-line)" }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 700 }}>{teamName(m.team_a_id)} v {teamName(m.team_b_id)}</span>
                      <span className="si-muted" style={{ display: "block", fontSize: 12.5 }}>{m.round_label}</span>
                    </span>
                    <span className="si-row">
                      {c ? <StatusPill status={c.status} /> : null}
                      {c ? <Link className="si-btn small primary" href={`/tournaments/${tournamentId}/score/${c.id}`}>{c.status === "completed" ? "Review" : "Score"}</Link>
                        : m.status === "completed" || m.status === "walkover" || m.status === "cancelled" ? <span className="si-muted" style={{ fontSize: 12.5 }}>Result entered by hand</span>
                        : <button type="button" className="si-btn small" disabled={pending || !ready} onClick={() => openMatch(m.id)}>{ready ? "Set up scoring" : "Teams not set"}</button>}
                    </span>
                  </div>
                );
              }) : <div className="si-muted">No fixtures yet. Add matches in the tournament console first.</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Every rule of the sport, as the engine reports it: numbers, switches
// and choices. Nothing here knows which sport it is editing.
function RulesForm({ tournamentId, sport, initial, onError }: { tournamentId: string; sport: SportKey; initial: Record<string, unknown>; onError: (m: string | null) => void }) {
  const [rules, setRules] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const set = (k: string, v: unknown) => { setSaved(false); setRules({ ...rules, [k]: v }); };
  const choices: Record<string, string[]> = {
    preset: ["t20", "odi", "test", "custom"], format: ["singles", "doubles"], scoring: ["side_out", "rally"], nextGameServe: ["alternate", "winner", "loser"],
  };
  const editable = Object.entries(rules).filter(([, v]) => v === null || ["number", "boolean", "string"].includes(typeof v));

  return (
    <details className="si-card si-more">
      <summary>Scoring rules for this tournament</summary>
      <div className="si-grid" style={{ gap: 12 }}>
        <div className="si-muted" style={{ fontSize: 12.5 }}>These apply to matches set up for scoring from now on. A match already being scored keeps the rules it started with. Leave a limit empty for &quot;no limit&quot;.</div>
        <div className="si-form">
          {editable.map(([k, v]) => (
            <label key={k} className="si-label">{label(k)}
              {choices[k] ? (
                <select className="si-input" value={String(v)} onChange={(e) => {
                  const value = e.target.value;
                  if (k !== "preset") { set(k, value); return; }
                  // a preset is a whole set of defaults, not one field
                  start(async () => { const d = await getRuleDefaults(sport, value); if (isActionError(d)) onError(d.message); else { setSaved(false); setRules(d); } });
                }}>{choices[k].map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}</select>
              ) : typeof v === "boolean" ? (
                <select className="si-input" value={v ? "yes" : "no"} onChange={(e) => set(k, e.target.value === "yes")}><option value="yes">Yes</option><option value="no">No</option></select>
              ) : (
                <input className="si-input" inputMode="numeric" value={v === null ? "" : String(v)} onChange={(e) => set(k, e.target.value.trim() === "" ? null : Number(e.target.value))} />
              )}
            </label>
          ))}
        </div>
        <div className="si-row">
          <button type="button" className="si-btn primary small" disabled={pending} onClick={() => start(async () => {
            const res = await saveScoringRules(tournamentId, rules);
            if (isActionError(res)) onError(res.message); else { onError(null); setRules(res); setSaved(true); }
          })}>Save rules</button>
          {saved ? <span className="si-muted" style={{ fontSize: 12.5 }}>Saved.</span> : null}
        </div>
      </div>
    </details>
  );
}

function RaceForm({ tournamentId, teams, onError }: { tournamentId: string; teams: HubTeam[]; onError: (m: string | null) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState({ distance: "100", stroke: "freestyle", course: "50", round: "heat", heat: "1", relay: false, relayLegs: "4", lanes: "8" });
  const [lanes, setLanes] = useState<Record<number, string>>({});
  const laneCount = Math.max(1, Math.min(10, Number(f.lanes) || 8));

  const create = () => start(async () => {
    const entries: SwimEntry[] = Object.entries(lanes).filter(([, id]) => id).map(([lane, id]) => {
      const team = teams.find((t) => t.id === id)!;
      const first = team.players[0];
      return f.relay
        ? { lane: Number(lane), entryId: team.id, name: team.name, teamId: team.id, swimmers: team.players.slice(0, Number(f.relayLegs)).map((p) => ({ name: p.name, teamPlayerId: p.id, userId: p.userId })) }
        : { lane: Number(lane), entryId: team.id, name: team.name, teamId: team.id, teamPlayerId: first?.id ?? null, userId: first?.userId ?? null };
    });
    const res = await openSwimRace(tournamentId, {
      distance: Number(f.distance), stroke: f.stroke as (typeof STROKES)[number], course: Number(f.course), round: f.round as (typeof ROUNDS)[number],
      heat: Number(f.heat), relay: f.relay, relayLegs: Number(f.relayLegs), lanes: laneCount, entries,
    });
    if (isActionError(res)) onError(res.message);
    else router.push(`/tournaments/${tournamentId}/score/${res.id}`);
  });

  return (
    <div className="si-card si-grid">
      <h2 className="si-h2" style={{ margin: 0 }}>Set up a race</h2>
      <div className="si-form">
        <label className="si-label">Distance (m)<input className="si-input" inputMode="numeric" value={f.distance} onChange={(e) => setF({ ...f, distance: e.target.value })} /></label>
        <label className="si-label">Stroke<select className="si-input" value={f.stroke} onChange={(e) => setF({ ...f, stroke: e.target.value })}>{STROKES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <label className="si-label">Pool length (m)<select className="si-input" value={f.course} onChange={(e) => setF({ ...f, course: e.target.value })}><option value="50">50</option><option value="25">25</option></select></label>
        <label className="si-label">Round<select className="si-input" value={f.round} onChange={(e) => setF({ ...f, round: e.target.value })}>{ROUNDS.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}</select></label>
        <label className="si-label">Heat number<input className="si-input" inputMode="numeric" value={f.heat} onChange={(e) => setF({ ...f, heat: e.target.value })} /></label>
        <label className="si-label">Lanes in the pool<input className="si-input" inputMode="numeric" value={f.lanes} onChange={(e) => setF({ ...f, lanes: e.target.value })} /></label>
        <label className="si-label">Relay<select className="si-input" value={f.relay ? "yes" : "no"} onChange={(e) => setF({ ...f, relay: e.target.value === "yes" })}><option value="no">No</option><option value="yes">Yes</option></select></label>
        {f.relay ? <label className="si-label">Swimmers per team<input className="si-input" inputMode="numeric" value={f.relayLegs} onChange={(e) => setF({ ...f, relayLegs: e.target.value })} /></label> : null}
      </div>
      <div className="si-form">
        {Array.from({ length: laneCount }, (_, i) => i + 1).map((lane) => (
          <label key={lane} className="si-label">Lane {lane}
            <select className="si-input" value={lanes[lane] ?? ""} onChange={(e) => setLanes({ ...lanes, [lane]: e.target.value })}>
              <option value="">Empty</option>
              {teams.filter((t) => t.id === lanes[lane] || !Object.values(lanes).includes(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        ))}
      </div>
      {f.relay ? <div className="si-muted" style={{ fontSize: 12.5 }}>Relay order follows the order of each team&apos;s roster.</div> : null}
      <div className="si-row"><button type="button" className="si-btn primary" disabled={pending} onClick={create}>Create race</button></div>
    </div>
  );
}
