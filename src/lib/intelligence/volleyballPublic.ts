// What the public volleyball pages read. Only what was recorded: a match
// entered without player figures adds nothing to a player's totals, and a
// team's record comes from its finished fixtures.

import { createAnonClient } from "@/lib/supabase/anonServer";
import { createClient, getViewerId } from "@/lib/supabase/server";
import type { MatchContext } from "./core/types";
import { attackEfficiency, pointsScored, type SetScore } from "./sports/volleyballRules";
import { IN_PLAY, LIVE_CONTEST_COLUMNS, livePlayerLines, type LiveContestRow } from "./volleyballLive";
import type { Tournament, TournamentMatch, TournamentTeam } from "@/lib/tournaments/types";
import { TEAM_PUBLIC_COLUMNS } from "@/lib/tournaments/columns";
import { tournamentPath } from "@/lib/tournaments/types";

const PUBLIC_STATUSES = ["published", "registration_open", "registration_closed", "live", "completed"];
const DONE = new Set(["completed", "walkover"]);

type Raw = Record<string, number>;
interface ContestRow { id: string; match_id: string | null; status: string; context: MatchContext; sets: SetScore[] | null }
interface LineRow { team_player_id: string | null; team_id: string | null; tournament_id: string; contest_id: string; raw: Raw }

export interface VolleyballTournamentCard {
  id: string; href: string; name: string; bannerUrl: string | null; organizer: string | null; venue: string;
  startsAt: string | null; status: string; maxTeams: number | null; fee: number;
}
export interface VolleyballMatchCard {
  id: string; tournamentName: string; venue: string; href: string; round: string | null; status: string; startsAt: string | null;
  teamA: string; teamB: string; logoA: string | null; logoB: string | null; hrefA: string | null; hrefB: string | null;
  scoreA: number | null; scoreB: number | null; winner: "a" | "b" | null; sets: SetScore[]; live: boolean;
}
export interface VolleyballTeamCard { id: string; href: string; name: string; logoUrl: string | null; tournamentName: string; played: number; won: number; lost: number }
export interface VolleyballPlayerCard { id: string; name: string; teamName: string; href: string | null; tournamentName: string; points: number; kills: number; aces: number; blocks: number }
export interface VolleyballDiscovery { tournaments: VolleyballTournamentCard[]; matches: VolleyballMatchCard[]; teams: VolleyballTeamCard[]; players: VolleyballPlayerCard[] }

const sum = (rows: Raw[]): Raw => {
  const out: Raw = {};
  for (const r of rows) for (const [k, v] of Object.entries(r)) if (typeof v === "number") out[k] = (out[k] ?? 0) + v;
  return out;
};

const recordOf = (matches: TournamentMatch[], teamId: string) => {
  const mine = matches.filter((m) => DONE.has(m.status) && m.team_b_id && (m.team_a_id === teamId || m.team_b_id === teamId));
  const won = mine.filter((m) => m.winner_team_id === teamId).length;
  return { played: mine.length, won, lost: mine.filter((m) => m.winner_team_id && m.winner_team_id !== teamId).length };
};

/** Every public volleyball tournament, with its matches, teams and recorded leaders. Cookie-free, so it can be cached. */
export async function getVolleyballDiscovery(): Promise<VolleyballDiscovery> {
  const sb = createAnonClient();
  const { data: rows, error } = await sb.from("tournaments").select("*, venues(name)").ilike("sport", "volleyball").in("status", PUBLIC_STATUSES)
    .order("starts_at", { ascending: true, nullsFirst: false }).limit(100);
  if (error) throw new Error(error.message);
  const list = (rows ?? []) as unknown as (Tournament & { venues: { name: string } | null })[];
  const ids = list.map((t) => t.id);
  if (!ids.length) return { tournaments: [], matches: [], teams: [], players: [] };

  const [matchRes, teamRes, contestRes, lineRes] = await Promise.all([
    sb.from("tournament_matches").select("*").in("tournament_id", ids).limit(2000),
    sb.from("tournament_teams").select(TEAM_PUBLIC_COLUMNS).in("tournament_id", ids).eq("status", "confirmed").limit(2000),
    sb.from("si_contests").select("id, match_id, status, context, sets:state->sport->sets").in("tournament_id", ids).limit(2000),
    sb.from("si_stat_lines").select("team_player_id, team_id, tournament_id, contest_id, raw").in("tournament_id", ids).eq("subject", "player").limit(5000),
  ]);
  for (const r of [matchRes, teamRes, contestRes, lineRes]) if (r.error) throw new Error(r.error.message);
  const matches = (matchRes.data ?? []) as unknown as TournamentMatch[];
  const teams = (teamRes.data ?? []) as unknown as TournamentTeam[];
  const contests = (contestRes.data ?? []) as unknown as ContestRow[];
  const { data: inPlay } = await sb.from("si_contests").select(LIVE_CONTEST_COLUMNS).in("tournament_id", ids).in("status", IN_PLAY).limit(100);
  const lines: LineRow[] = [...(lineRes.data ?? []) as unknown as LineRow[], ...livePlayerLines((inPlay ?? []) as unknown as LiveContestRow[])];

  const tournamentOf = new Map(list.map((t) => [t.id, t]));
  const venueOf = (t: Tournament & { venues: { name: string } | null }) => t.venues?.name ?? t.own_venue_name ?? "";
  const teamOf = new Map(teams.map((t) => [t.id, t]));
  const contestOf = new Map(contests.filter((c) => c.match_id).map((c) => [c.match_id!, c]));
  const teamHref = (t: Tournament, id: string | null) => (id && teamOf.has(id) ? `${tournamentPath(t)}/teams/${id}` : null);

  const playerName = new Map<string, string>();
  for (const c of contests) for (const side of Object.values(c.context?.sides ?? {})) for (const p of side.players) playerName.set(p.id, p.name);

  const byPlayer = new Map<string, LineRow[]>();
  for (const l of lines) if (l.team_player_id) byPlayer.set(l.team_player_id, [...(byPlayer.get(l.team_player_id) ?? []), l]);

  return {
    tournaments: list.map((t) => ({
      id: t.id, href: tournamentPath(t), name: t.name, bannerUrl: t.banner_url ?? null, organizer: t.organizer_name ?? null, venue: venueOf(t) || "To be announced",
      startsAt: t.starts_at, status: t.status, maxTeams: t.max_teams ?? null, fee: Number(t.fee) || 0,
    })),
    matches: matches.filter((m) => m.team_a_id && m.team_b_id && m.status !== "cancelled").map((m) => {
      const t = tournamentOf.get(m.tournament_id)!;
      const c = contestOf.get(m.id);
      const a = teamOf.get(m.team_a_id!), b = teamOf.get(m.team_b_id!);
      return {
        id: m.id, tournamentName: t.name, venue: venueOf(t), href: c ? `${tournamentPath(t)}/live/${c.id}` : `${tournamentPath(t)}?tab=fixtures`,
        round: m.round_label ?? null, status: m.status, startsAt: m.starts_at, teamA: a?.name ?? "TBD", teamB: b?.name ?? "TBD",
        logoA: a?.logo_url ?? null, logoB: b?.logo_url ?? null, hrefA: teamHref(t, m.team_a_id), hrefB: teamHref(t, m.team_b_id),
        scoreA: m.score_a, scoreB: m.score_b, winner: m.winner_team_id === m.team_a_id ? "a" as const : m.winner_team_id === m.team_b_id ? "b" as const : null,
        sets: (c?.sets ?? []).filter((g) => g.a + g.b > 0).map((g) => ({ a: g.a, b: g.b })), live: m.status === "live",
      };
    }),
    teams: teams.map((t) => {
      const parent = tournamentOf.get(t.tournament_id)!;
      return { id: t.id, href: `${tournamentPath(parent)}/teams/${t.id}`, name: t.name, logoUrl: t.logo_url ?? null, tournamentName: parent.name, ...recordOf(matches.filter((m) => m.tournament_id === t.tournament_id), t.id) };
    }).filter((t) => t.played > 0).sort((x, y) => y.won - x.won || x.lost - y.lost || x.name.localeCompare(y.name)),
    players: [...byPlayer.entries()].map(([id, ls]) => {
      const raw = sum(ls.map((l) => l.raw));
      const parent = tournamentOf.get(ls[0].tournament_id)!;
      const team = ls[0].team_id ? teamOf.get(ls[0].team_id) : undefined;
      return {
        id, name: playerName.get(id) ?? "Player", teamName: team?.name ?? "", href: `${tournamentPath(parent)}/players/${id}`, tournamentName: parent.name,
        points: pointsScored(raw), kills: raw.kills ?? 0, aces: raw.aces ?? 0, blocks: raw.blocks ?? 0,
      };
    }).filter((p) => p.points > 0).sort((x, y) => y.points - x.points || x.name.localeCompare(y.name)),
  };
}

export interface VolleyballRosterRow { id: string; name: string; role: string; number: number | null; position: string | null; points: number | null; kills: number | null; aces: number | null; blocks: number | null; digs: number | null; assists: number | null }
export interface VolleyballTeamProfile {
  team: TournamentTeam;
  record: { played: number; won: number; lost: number; setsWon: number; setsLost: number };
  results: VolleyballMatchRow[];
  upcoming: VolleyballMatchRow[];
  /** null: the viewer isn't signed in, and rosters are for signed-in members (as on the Teams tab) */
  roster: VolleyballRosterRow[] | null;
}
export interface VolleyballMatchRow { id: string; opponent: string; opponentHref: string | null; round: string | null; startsAt: string | null; status: string; href: string | null; mine: number | null; theirs: number | null; won: boolean | null; sets: string }

/** One team's public page. Null when the team isn't in this tournament. */
export async function getVolleyballTeamProfile(tournament: Tournament, teamId: string): Promise<VolleyballTeamProfile | null> {
  const sb = await createClient();
  const { data: teamRow } = await sb.from("tournament_teams").select(TEAM_PUBLIC_COLUMNS).eq("id", teamId).eq("tournament_id", tournament.id).maybeSingle();
  if (!teamRow) return null;
  const team = teamRow as unknown as TournamentTeam;
  const [matchRes, teamsRes, contestRes, viewer] = await Promise.all([
    sb.from("tournament_matches").select("*").eq("tournament_id", tournament.id).limit(1000),
    sb.from("tournament_teams").select("id, name").eq("tournament_id", tournament.id).limit(500),
    sb.from("si_contests").select("id, match_id, status, context, sets:state->sport->sets").eq("tournament_id", tournament.id).limit(1000),
    getViewerId(),
  ]);
  const matches = ((matchRes.data ?? []) as unknown as TournamentMatch[]).filter((m) => m.team_a_id === teamId || m.team_b_id === teamId);
  const nameOf = new Map(((teamsRes.data ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
  const contests = (contestRes.data ?? []) as unknown as ContestRow[];
  const contestOf = new Map(contests.filter((c) => c.match_id).map((c) => [c.match_id!, c]));

  const rowOf = (m: TournamentMatch): VolleyballMatchRow => {
    const isA = m.team_a_id === teamId;
    const other = isA ? m.team_b_id : m.team_a_id;
    const c = contestOf.get(m.id);
    const sets = (c?.sets ?? []).filter((g) => g.a + g.b > 0);
    return {
      id: m.id, opponent: other ? nameOf.get(other) ?? "TBD" : "TBD", opponentHref: other ? `${tournamentPath(tournament)}/teams/${other}` : null, round: m.round_label ?? null, startsAt: m.starts_at, status: m.status,
      href: c ? `${tournamentPath(tournament)}/live/${c.id}` : null, mine: isA ? m.score_a : m.score_b, theirs: isA ? m.score_b : m.score_a,
      won: m.winner_team_id ? m.winner_team_id === teamId : null, sets: sets.map((g) => (isA ? `${g.a}–${g.b}` : `${g.b}–${g.a}`)).join(", "),
    };
  };
  const when = (m: TournamentMatch) => m.starts_at ?? "9999";
  const done = matches.filter((m) => DONE.has(m.status));
  const scored = done.filter((m) => m.status === "completed");

  let roster: VolleyballRosterRow[] | null = null;
  if (viewer) {
    const [{ data: people }, { data: finished }, { data: inPlay }] = await Promise.all([
      sb.rpc("get_team_roster_public", { p_team_id: teamId }),
      sb.from("si_stat_lines").select("team_player_id, raw").eq("team_id", teamId).eq("subject", "player").limit(2000),
      sb.from("si_contests").select(LIVE_CONTEST_COLUMNS).eq("tournament_id", tournament.id).in("status", IN_PLAY),
    ]);
    const lines = [...(finished ?? []) as { team_player_id: string | null; raw: Raw }[], ...livePlayerLines((inPlay ?? []) as unknown as LiveContestRow[]).filter((l) => l.team_id === teamId)];
    // jersey and position come from the rosters frozen into the matches
    const details = new Map<string, { number: number | null; position: string | null }>();
    for (const c of contests) for (const side of Object.values(c.context?.sides ?? {})) if (side.teamId === teamId) for (const p of side.players) details.set(p.id, { number: p.number ?? null, position: p.position ?? null });
    const rawOf = new Map<string, Raw[]>();
    for (const l of lines) if (l.team_player_id) rawOf.set(l.team_player_id, [...(rawOf.get(l.team_player_id) ?? []), l.raw]);
    roster = ((people ?? []) as { id: string; name: string; role: string }[]).map((p) => {
      const raw = rawOf.has(p.id) ? sum(rawOf.get(p.id)!) : null;
      return {
        id: p.id, name: p.name, role: p.role, number: details.get(p.id)?.number ?? null, position: details.get(p.id)?.position ?? null,
        points: raw ? pointsScored(raw) : null, kills: raw ? raw.kills ?? 0 : null, aces: raw ? raw.aces ?? 0 : null, blocks: raw ? raw.blocks ?? 0 : null, digs: raw ? raw.digs ?? 0 : null, assists: raw ? raw.assists ?? 0 : null,
      };
    }).sort((x, y) => (x.number ?? 9999) - (y.number ?? 9999) || x.name.localeCompare(y.name));
  }

  return {
    team,
    record: {
      ...recordOf(matches, teamId),
      setsWon: scored.reduce((n, m) => n + ((m.team_a_id === teamId ? m.score_a : m.score_b) ?? 0), 0),
      setsLost: scored.reduce((n, m) => n + ((m.team_a_id === teamId ? m.score_b : m.score_a) ?? 0), 0),
    },
    results: done.sort((x, y) => when(y).localeCompare(when(x))).map(rowOf),
    upcoming: matches.filter((m) => !DONE.has(m.status) && m.status !== "cancelled").sort((x, y) => when(x).localeCompare(when(y))).map(rowOf),
    roster,
  };
}

export interface VolleyballPlayerLine { matchId: string | null; contestId: string; raw: Raw }

/** A roster player's recorded figures, one line per match, and their totals. */
export async function getVolleyballPlayerLines(tournamentId: string, teamPlayerId: string): Promise<{ lines: VolleyballPlayerLine[]; totals: Raw; attackPct: number | null }> {
  const sb = await createClient();
  const [{ data }, { data: contests }, { data: inPlay }] = await Promise.all([
    sb.from("si_stat_lines").select("contest_id, raw").eq("tournament_id", tournamentId).eq("team_player_id", teamPlayerId).eq("subject", "player").limit(500),
    sb.from("si_contests").select("id, match_id").eq("tournament_id", tournamentId).limit(1000),
    sb.from("si_contests").select(LIVE_CONTEST_COLUMNS).eq("tournament_id", tournamentId).in("status", IN_PLAY),
  ]);
  const matchOf = new Map(((contests ?? []) as { id: string; match_id: string | null }[]).map((c) => [c.id, c.match_id]));
  const lines = [
    ...((data ?? []) as { contest_id: string; raw: Raw }[]).map((l) => ({ matchId: matchOf.get(l.contest_id) ?? null, contestId: l.contest_id, raw: l.raw })),
    ...livePlayerLines((inPlay ?? []) as unknown as LiveContestRow[]).filter((l) => l.team_player_id === teamPlayerId).map((l) => ({ matchId: l.match_id, contestId: l.contest_id, raw: l.raw })),
  ];
  const totals = sum(lines.map((l) => l.raw));
  return { lines, totals, attackPct: attackEfficiency(totals) };
}
