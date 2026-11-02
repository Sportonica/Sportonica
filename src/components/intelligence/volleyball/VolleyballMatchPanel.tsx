"use client";

// The public match page's volleyball detail: the set scorecard, who is on
// court and who serves, and the facts of the match. Follows the live
// contest, so it updates without a refresh.

import type { ContestView } from "@/lib/intelligence/types";
import type { Side } from "@/lib/intelligence/core/types";
import type { VolleyballState } from "@/lib/intelligence/sports/volleyball";
import { Court, MatchClock, SetScorecard, playerOf, shortName } from "./parts";

export interface VolleyballMatchInfo { venue: string | null; court: string | null; startsAt: string | null; round: string | null; logos?: Record<Side, string | null> }

const CARD: Record<string, string> = { yellow: "Yellow card", red: "Red card", expulsion: "Expulsion", disqualification: "Disqualification" };

export default function VolleyballMatchPanel({ contest, tournamentName, info }: { contest: ContestView; tournamentName: string; info: VolleyballMatchInfo | null }) {
  const s = contest.state as VolleyballState | null;
  if (!s) return null;
  const ctx = contest.context;
  const sides = ["a", "b"] as Side[];
  const anyCourt = sides.some((x) => s.rotation[x]);
  const name = (id: string) => {
    for (const side of sides) { const p = playerOf(ctx, side, id); if (p) return shortName(p); }
    return "Player";
  };
  const date = info?.startsAt ? new Date(info.startsAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kathmandu" }) : null;
  const facts: [string, React.ReactNode][] = [
    ["Tournament", tournamentName],
    ...(info?.round ? [["Round", info.round] as [string, React.ReactNode]] : []),
    ...(info?.venue ? [["Venue", info.venue] as [string, React.ReactNode]] : []),
    ...(info?.court ? [["Court", info.court] as [string, React.ReactNode]] : []),
    ...(date ? [["Date", date] as [string, React.ReactNode]] : []),
    ...(contest.startedAt && !s.manual ? [[contest.completedAt ? "Duration" : "Elapsed", <MatchClock key="c" startedAt={contest.startedAt} completedAt={contest.completedAt} />] as [string, React.ReactNode]] : []),
    ...(s.mvp ? [["Match MVP", name(s.mvp)] as [string, React.ReactNode]] : []),
    ...s.officials.map((o) => [o.role, o.name] as [string, React.ReactNode]),
  ];
  // starting order and who has been on court: from the rotation log, never from the roster alone
  const subs = s.rotationLog.filter((r) => r.why === "Substitution" || r.why.startsWith("Libero"));
  // only what the scorer added: nobody appears here with a made-up figure
  const added = sides.map((x) => ({
    side: x,
    rows: (ctx.sides?.[x].players ?? []).map((p) => ({ p, pts: s.players[p.id]?.manualPoints ?? 0 })).filter((r) => r.pts > 0).sort((u, v) => v.pts - u.pts),
  }));

  return (
    <>
      <SetScorecard state={s} context={ctx} />
      {s.manual ? <div className="si-info">The result was entered after the match{Object.keys(s.players).length ? ", with player statistics." : ". Player statistics were not recorded."}</div> : null}
      {added.some((x) => x.rows.length) ? (
        <div className="si-card">
          <h2 className="si-h2">Player points</h2>
          <div className="vb-courts">
            {added.filter((x) => x.rows.length).map((x) => (
              <div key={x.side}>
                <div className="vb-court-t">{ctx.sides?.[x.side].name}</div>
                <ul className="vb-pts-public">
                  {x.rows.map(({ p, pts }) => <li key={p.id}><span>{shortName(p)}</span><b>{pts}</b></li>)}
                </ul>
              </div>
            ))}
          </div>
          <div className="si-muted" style={{ fontSize: 12.5, marginTop: 10 }}>Entered by the scorer for each player. These are separate from the team score above.</div>
        </div>
      ) : null}
      {anyCourt && !s.decided ? (
        <div className="si-card">
          <h2 className="si-h2">On court</h2>
          <div className="vb-courts">{sides.map((x) => <Court key={x} state={s} context={ctx} side={x} />)}</div>
        </div>
      ) : null}
      {sides.some((x) => s.starting[x]) ? (
        <div className="si-card">
          <h2 className="si-h2">Starting lineups</h2>
          <div className="vb-courts">
            {sides.map((x) => (
              <div key={x}>
                <div className="vb-court-t">{ctx.sides?.[x].name}</div>
                <ol className="vb-log" style={{ listStylePosition: "inside" }}>
                  {(s.starting[x] ?? []).map((id) => <li key={id}>{name(id)}</li>)}
                </ol>
                {s.liberos[x].length ? <div className="si-muted" style={{ fontSize: 12.5, marginTop: 6 }}>Libero: {s.liberos[x].map(name).join(", ")}</div> : null}
              </div>
            ))}
          </div>
          {subs.length ? <div className="si-muted" style={{ fontSize: 12.5, marginTop: 10 }}>{subs.length} substitution{subs.length === 1 ? "" : "s"} and Libero changes. See the Timeline tab.</div> : null}
        </div>
      ) : null}
      {s.sanctions.length ? (
        <div className="si-card">
          <h2 className="si-h2">Sanctions</h2>
          <ul className="vb-log">
            {s.sanctions.map((x) => <li key={x.seq}>Set {x.set}: {CARD[x.card] ?? x.card}, {x.player ? name(x.player) : ctx.sides?.[x.side].name}</li>)}
          </ul>
        </div>
      ) : null}
      <div className="si-card">
        <h2 className="si-h2">Match information</h2>
        <dl className="vb-facts" style={{ margin: 0 }}>
          {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
        {s.notes ? <p className="si-muted" style={{ fontSize: 13, margin: "10px 0 0" }}>{s.notes}</p> : null}
      </div>
    </>
  );
}
