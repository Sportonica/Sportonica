"use client";

// The organizer chooses who goes through to the knockout stage: each
// group's teams in table order, each one set to a place (1st, 2nd, ...)
// or Out. The table's top N come pre-set; any team can be picked, and it
// works before every group match is played (generateKnockoutFromPicks).

import { useEffect, useMemo, useState } from "react";
import { getTournamentStandings } from "@/lib/tournaments/actions";
import { isActionError } from "@/lib/actionError";
import type { TournamentStanding, TournamentTeam } from "@/lib/tournaments/types";

const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
// rounds named the way the bracket names them, for the summary line
const firstRound = (n: number) => {
  let size = 1;
  while (size < n) size *= 2;
  return size <= 2 ? "Final" : size === 4 ? "Semifinals" : size === 8 ? "Quarterfinals" : `Round of ${size}`;
};

export default function QualifierPicker({ tournamentId, teams, perGroup, groupsLeft, pending, onGenerate, onCancel }: {
  tournamentId: string;
  teams: TournamentTeam[];
  perGroup: number;
  groupsLeft: number;
  pending: boolean;
  onGenerate: (picks: Record<string, string[]>) => void;
  onCancel: () => void;
}) {
  const groups = useMemo(
    () => [...new Set(teams.filter((t) => t.status === "confirmed" && t.group_name).map((t) => t.group_name as string))].sort(),
    [teams],
  );
  const [tables, setTables] = useState<Record<string, TournamentStanding[]> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // team id -> place in its group (0 = out)
  const [place, setPlace] = useState<Record<string, number>>({});

  useEffect(() => {
    let off = false;
    (async () => {
      const res = await Promise.all(groups.map((g) => getTournamentStandings(tournamentId, g)));
      if (off) return;
      const failed = res.find(isActionError);
      if (failed) { setErr(failed.message); return; }
      const t: Record<string, TournamentStanding[]> = {};
      const p: Record<string, number> = {};
      groups.forEach((g, i) => {
        t[g] = res[i] as TournamentStanding[];
        t[g].forEach((row, k) => { p[row.team_id] = k < perGroup ? k + 1 : 0; });
      });
      setTables(t); setPlace(p);
    })();
    return () => { off = true; };
  }, [groups, tournamentId, perGroup]);

  if (err) return <div className="tc-err">{err}</div>;
  if (!tables) return <div className="tc-dim" style={{ fontSize: 13 }}>Loading the group tables…</div>;

  // a group's places must run 1, 2, 3 ... with no gaps or repeats
  const problems: string[] = [];
  const picks: Record<string, string[]> = {};
  for (const g of groups) {
    const chosen = tables[g].filter((r) => place[r.team_id] > 0).sort((a, b) => place[a.team_id] - place[b.team_id]);
    const places = chosen.map((r) => place[r.team_id]);
    if (places.some((p, i) => p !== i + 1)) problems.push(`Group ${g}: give each team a different place, starting from 1st.`);
    if (chosen.length) picks[g] = chosen.map((r) => r.team_id);
  }
  const total = Object.values(picks).reduce((n, ids) => n + ids.length, 0);
  if (total < 2) problems.push("Pick at least two teams.");

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="tc-card-sub" style={{ margin: 0 }}>
        Set each team&apos;s place, or Out. The table&apos;s top {perGroup} of each group are filled in; change any of them.
        Group winners meet a runner-up from another group, as with the standings.
      </div>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))" }}>
        {groups.map((g) => (
          <div key={g} style={{ border: "1px solid var(--line, rgba(128,128,128,.3))", borderRadius: 10, padding: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>Group {g}</div>
            {tables[g].map((r, k) => (
              <div key={r.team_id} style={{ display: "grid", gridTemplateColumns: "18px 1fr auto auto", gap: 8, alignItems: "center", padding: "4px 0", fontSize: 13 }}>
                <span className="tc-dim">{k + 1}</span>
                <span style={{ fontWeight: place[r.team_id] ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.team_name}</span>
                <span className="tc-dim" style={{ fontSize: 11.5 }}>{r.played}P {r.points}pts</span>
                <select
                  aria-label={`${r.team_name}: place`} value={place[r.team_id] ?? 0}
                  onChange={(e) => setPlace((p) => ({ ...p, [r.team_id]: Number(e.target.value) }))}
                  style={{ fontSize: 12.5, padding: "3px 4px", borderRadius: 6 }}
                >
                  <option value={0}>Out</option>
                  {tables[g].map((_, i) => <option key={i} value={i + 1}>{ordinal(i + 1)}</option>)}
                </select>
              </div>
            ))}
          </div>
        ))}
      </div>
      {problems.length ? <div className="tc-err">{problems[0]}</div> : (
        <div style={{ fontSize: 13 }}><b>{total} teams</b> go through, starting with the <b>{firstRound(total)}</b>.</div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          className="tc-btn primary" disabled={pending || problems.length > 0}
          onClick={() => {
            const warn = groupsLeft > 0 ? `\n\n${groupsLeft} group ${groupsLeft === 1 ? "match has" : "matches have"} no result yet; they will not change who goes through.` : "";
            if (!window.confirm(`Generate the knockout stage with these ${total} teams?${warn}`)) return;
            onGenerate(picks);
          }}
        >
          Generate knockout with these teams
        </button>
        <button className="tc-btn" disabled={pending} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
