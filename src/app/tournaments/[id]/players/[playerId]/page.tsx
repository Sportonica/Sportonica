import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ChevronLeft, Star } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getTournament, getTournamentPlayerCard } from "@/lib/tournaments/actions";
import { isActionError } from "@/lib/actionError";
import { tournamentPath, type TournamentPlayerCard } from "@/lib/tournaments/types";
import { isVolleyball } from "@/lib/tournaments/standings";
import { getVolleyballPlayerLines, getVolleyballTeamProfile } from "@/lib/intelligence/volleyballPublic";
import { pointsScored } from "@/lib/intelligence/sports/volleyballRules";
import "@/app/p/profile.css";

export const dynamic = "force-dynamic";

// A tournament player's card for a goals sport (futsal, football).
// Walk-in players have no profile, so this is keyed by their roster row;
// viewing it needs a sign-in, like the Player Stats tab it links from.

async function load(segment: string, playerId: string) {
  const tournament = await getTournament(segment);
  if (isActionError(tournament) || !tournament) return null;
  const card = await getTournamentPlayerCard(tournament.id, playerId);
  if (isActionError(card) || !card) return null;
  return { tournament, card };
}

const totals = (card: TournamentPlayerCard) => card.matches.reduce(
  (t, m) => ({
    goals: t.goals + m.goals, assists: t.assists + m.assists, mom: t.mom + (m.is_mom ? 1 : 0),
    yellow: t.yellow + m.yellow_cards, red: t.red + (m.red_card ? 1 : 0),
  }),
  { goals: 0, assists: 0, mom: 0, yellow: 0, red: 0 },
);

export async function generateMetadata({ params }: { params: Promise<{ id: string; playerId: string }> }): Promise<Metadata> {
  const { id, playerId } = await params;
  const got = await load(id, playerId);
  if (!got) return { title: "Player · Sportonica" };
  const { tournament, card } = got;
  const t = totals(card);
  const title = `${card.player.name} · ${card.player.team_name} · Sportonica`;
  const description = `${t.goals} goal${t.goals !== 1 ? "s" : ""} in ${card.matches.length} match${card.matches.length !== 1 ? "es" : ""} · ${tournament.name}`;
  return { title, description, openGraph: { title, description, type: "profile" }, twitter: { card: "summary", title, description } };
}

const day = (iso: string | null) => iso
  ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Asia/Kathmandu" })
  : "TBD";

export default async function TournamentPlayerPage({ params }: { params: Promise<{ id: string; playerId: string }> }) {
  const { id: segment, playerId } = await params;
  const sb = await createClient();
  const { data: claims } = await sb.auth.getClaims();
  if (!claims?.claims?.sub) redirect(`/login?redirect=${encodeURIComponent(`/tournaments/${segment}/players/${playerId}`)}`);
  const got = await load(segment, playerId);
  if (!got) notFound();
  const { tournament, card } = got;
  // Old /tournaments/<uuid>/players/... links land on the name-based URL.
  if (tournament.slug && segment !== tournament.slug) redirect(`${tournamentPath(tournament)}/players/${playerId}`);

  const { player } = card;
  const t = totals(card);
  const back = `${tournamentPath(tournament)}?tab=player-stats`;

  if (isVolleyball(tournament.sport)) {
    const [{ lines, totals: v, attackPct }, teamPage] = await Promise.all([getVolleyballPlayerLines(tournament.id, playerId), getVolleyballTeamProfile(tournament, player.team_id)]);
    const played = [...(teamPage?.results ?? []), ...(teamPage?.upcoming ?? []).filter((m) => m.status === "live")];
    const figures: [string, number | string][] = [
      ["Points", pointsScored(v)], ["Kills", v.kills ?? 0], ["Aces", v.aces ?? 0], ["Blocks", v.blocks ?? 0], ["Digs", v.digs ?? 0], ["Assists", v.assists ?? 0],
      ...(attackPct !== null ? [["Attack efficiency", `${attackPct}%`] as [string, string]] : []),
    ];
    const lineOf = new Map(lines.map((l) => [l.matchId, l]));
    return (
      <div className="pf">
        <div className="pf-wrap">
          <Link href={`${tournamentPath(tournament)}/teams/${player.team_id}`} className="pf-back"><ChevronLeft size={15} /> {player.team_name}</Link>
          <div className="pf-eyebrow" style={{ marginTop: 22 }}>Player card <span className="sep" /> Volleyball</div>
          <div className="pf-hero">
            <h1 className="pf-name">{player.name}</h1>
            {player.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="pf-avatar" src={player.avatar_url} alt={player.name} />
            ) : <div className="pf-avatar">{player.jersey_number ?? player.name.charAt(0).toUpperCase()}</div>}
          </div>
          <div className="pf-meta">
            <span>{player.team_name}</span>
            {player.jersey_number !== null && <span>#{player.jersey_number}</span>}
            {player.position && <span>{player.position}</span>}
            {player.is_captain && <span>Captain</span>}
            {player.username && <Link href={`/p/${player.username}`} style={{ color: "inherit" }}>@{player.username}</Link>}
          </div>
          {lines.length ? (
            <div className="pf-stats">{figures.map(([label, value]) => <div key={label} className="pf-stat"><div className="pf-stat-v">{value}</div><div className="pf-stat-l">{label}</div></div>)}</div>
          ) : null}
          <section className="pf-sec">
            <div className="pf-sec-head"><span className="pf-sec-num">01</span><h2 className="pf-sec-t">Match by match</h2></div>
            {played.length === 0 ? <div className="pf-empty">{player.team_name} hasn&apos;t played yet.</div> : played.map((m) => {
              const raw = lineOf.get(m.id)?.raw;
              const line = raw ? [`${raw.kills ?? 0} kills`, `${raw.aces ?? 0} aces`, `${raw.blocks ?? 0} blocks`, `${raw.digs ?? 0} digs`, `${raw.assists ?? 0} assists`].join(" · ") : null;
              const result = m.status === "walkover" ? "Walkover" : m.mine !== null && m.theirs !== null ? `${m.won === null ? "" : m.won ? "W " : "L "}${m.mine}–${m.theirs}` : null;
              return (
                <div key={m.id} className="pf-game">
                  <span className="pf-game-date">{day(m.startsAt)}</span>
                  <div>
                    <div className="pf-game-t">v {m.opponent}</div>
                    <div className="pf-game-v">{[m.round, result, m.status === "live" && "Live", line].filter(Boolean).join(" · ")}</div>
                  </div>
                  <span className="pf-game-t" style={{ whiteSpace: "nowrap" }}>{raw ? `${pointsScored(raw)} pts` : <span style={{ color: "var(--pf-faint)" }}>–</span>}</span>
                </div>
              );
            })}
          </section>
          <div className="pf-trustline">
            <span>Sportonica · {tournament.name}</span>
            <Link href={back} style={{ color: "inherit" }}>All player stats</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pf">
      <div className="pf-wrap">
        <Link href={back} className="pf-back"><ChevronLeft size={15} /> {tournament.name}</Link>

        <div className="pf-eyebrow" style={{ marginTop: 22 }}>
          Player card <span className="sep" /> {tournament.sport}
          {player.group_name && <><span className="sep" /> Group {player.group_name}</>}
        </div>

        <div className="pf-hero">
          <h1 className="pf-name">{player.name}</h1>
          {player.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="pf-avatar" src={player.avatar_url} alt={player.name} />
          ) : player.team_logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="pf-avatar" src={player.team_logo_url} alt={player.team_name} />
          ) : (
            <div className="pf-avatar">{player.jersey_number ?? player.name.charAt(0).toUpperCase()}</div>
          )}
        </div>

        <div className="pf-meta">
          <span>{player.team_name}</span>
          {player.jersey_number !== null && <span>#{player.jersey_number}</span>}
          {player.position && <span>{player.position}</span>}
          {player.is_captain && <span>Captain</span>}
          {player.username && <Link href={`/p/${player.username}`} style={{ color: "inherit" }}>@{player.username}</Link>}
        </div>

        <div className="pf-stats">
          <div className="pf-stat"><div className="pf-stat-v">{t.goals}</div><div className="pf-stat-l">Goals</div></div>
          <div className="pf-stat"><div className="pf-stat-v">{t.assists}</div><div className="pf-stat-l">Assists</div></div>
          <div className="pf-stat"><div className="pf-stat-v">{card.matches.length}</div><div className="pf-stat-l">Matches</div></div>
          <div className="pf-stat"><div className="pf-stat-v">{t.mom}</div><div className="pf-stat-l">Player of the match</div></div>
        </div>

        <section className="pf-sec">
          <div className="pf-sec-head">
            <span className="pf-sec-num">01</span>
            <h2 className="pf-sec-t">Match by match</h2>
            {(t.yellow > 0 || t.red > 0) && (
              <span className="pf-sec-count">
                {[t.yellow > 0 && `${t.yellow} yellow`, t.red > 0 && `${t.red} red`].filter(Boolean).join(" · ")}
              </span>
            )}
          </div>
          {card.matches.length === 0 ? (
            <div className="pf-empty">No match figures recorded for {player.name} yet.</div>
          ) : (
            card.matches.map((m) => {
              const scored = m.goals_for !== null && m.goals_against !== null;
              const done = m.status === "completed";
              const result = m.status === "walkover" ? "Walkover"
                : !scored ? null
                : !done ? `${m.goals_for}–${m.goals_against}`
                : `${m.winner_team_id === player.team_id ? "W" : m.winner_team_id ? "L" : "D"} ${m.goals_for}–${m.goals_against}`;
              const line = [
                m.assists > 0 && `${m.assists} assist${m.assists !== 1 ? "s" : ""}`,
                m.yellow_cards > 0 && `${m.yellow_cards} yellow`,
                m.red_card && "red card",
              ].filter(Boolean).join(" · ");
              return (
                <div key={m.match_id} className="pf-game">
                  <span className="pf-game-date">{day(m.starts_at)}</span>
                  <div>
                    <div className="pf-game-t">
                      v {m.opponent ?? "TBD"}
                      {m.is_mom && <Star size={13} fill="currentColor" style={{ marginLeft: 6, color: "#E8B04B", verticalAlign: -1 }} aria-label="Player of the match" />}
                    </div>
                    <div className="pf-game-v">
                      {[m.round_label, result, m.status === "live" && "Live", line].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <span className="pf-game-t" style={{ whiteSpace: "nowrap" }}>
                    {m.goals > 0 ? `${m.goals} goal${m.goals !== 1 ? "s" : ""}` : <span style={{ color: "var(--pf-faint)" }}>–</span>}
                  </span>
                </div>
              );
            })
          )}
        </section>

        <div className="pf-trustline">
          <span>Sportonica · {tournament.name}</span>
          <Link href={back} style={{ color: "inherit" }}>All player stats</Link>
        </div>
      </div>
    </div>
  );
}
