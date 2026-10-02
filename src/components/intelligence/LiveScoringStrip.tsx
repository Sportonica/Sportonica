// On the public tournament page: the event-scored matches (live first),
// each linking to its match centre. Renders nothing for a sport without
// an engine, or while no match has been set up for scoring.

import Link from "next/link";
import { canScoreTournament, listTournamentContests } from "@/lib/intelligence/actions";
import { sportKeyFor } from "@/lib/intelligence/registry";
import { isActionError } from "@/lib/actionError";
import { StatusPill } from "./views";
import "./intelligence.css";

const ORDER = ["live", "paused", "scheduled", "postponed", "completed", "abandoned", "cancelled"];

export default async function LiveScoringStrip({ tournamentId, sport }: { tournamentId: string; sport: string }) {
  if (!sportKeyFor(sport)) return null;
  const [res, canScore] = await Promise.all([listTournamentContests(tournamentId), canScoreTournament(tournamentId)]);
  const contests = isActionError(res) ? [] : [...res].sort((x, y) => ORDER.indexOf(x.status) - ORDER.indexOf(y.status));
  if (!contests.length && !canScore) return null;

  return (
    <div className="si" style={{ margin: "18px 0" }}>
      <div className="si-card si-grid">
        <div className="si-chart-head" style={{ margin: 0 }}>
          <h2 className="si-h2" style={{ margin: 0 }}>Match centre</h2>
          {canScore ? <Link className="si-btn small primary" href={`/tournaments/${tournamentId}/score`}>Live scoring</Link> : null}
        </div>
        {contests.length ? contests.map((c) => {
          const v = c.summary.view;
          return (
            <Link key={c.id} href={`/tournaments/${tournamentId}/live/${c.id}`} className="si-row" style={{ justifyContent: "space-between", textDecoration: "none", color: "inherit", padding: "10px 0", borderTop: "1px solid var(--si-line)" }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 700, display: "block" }}>{c.label}</span>
                <span className="si-muted" style={{ fontSize: 12.5 }}>{c.summary.resultText ?? v.periodLabel}</span>
              </span>
              <span className="si-row">
                {v.kind === "versus" && v.score ? <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{v.score.a} : {v.score.b}</span> : null}
                <StatusPill status={c.status} />
              </span>
            </Link>
          );
        }) : <div className="si-muted" style={{ fontSize: 13.5 }}>No match has been set up for live scoring yet.</div>}
      </div>
    </div>
  );
}
