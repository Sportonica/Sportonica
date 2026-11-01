import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ChevronLeft } from "lucide-react";
import { getTournament } from "@/lib/tournaments/actions";
import { getVolleyballTeamProfile, type VolleyballMatchRow } from "@/lib/intelligence/volleyballPublic";
import { isActionError } from "@/lib/actionError";
import { isVolleyball } from "@/lib/tournaments/standings";
import { tournamentPath } from "@/lib/tournaments/types";
import "@/app/p/profile.css";
import "./team.css";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string; teamId: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(segment: string, teamId: string) {
  if (!UUID.test(teamId)) return null;
  const tournament = await getTournament(segment);
  if (isActionError(tournament) || !tournament || !isVolleyball(tournament.sport)) return null;
  const profile = await getVolleyballTeamProfile(tournament, teamId);
  return profile ? { tournament, profile } : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id, teamId } = await params;
  const got = await load(id, teamId);
  return { title: got ? `${got.profile.team.name} · ${got.tournament.name} · Sportonica` : "Team · Sportonica" };
}

const day = (iso: string | null) => iso
  ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Asia/Kathmandu" })
  : "TBD";

function MatchLine({ m }: { m: VolleyballMatchRow }) {
  const result = m.status === "walkover" ? `${m.won ? "Won" : "Lost"} by walkover`
    : m.mine !== null && m.theirs !== null ? `${m.won === null ? "" : m.won ? "W " : "L "}${m.mine}–${m.theirs}` : null;
  return (
    <div className="pf-game">
      <span className="pf-game-date">{day(m.startsAt)}</span>
      <div>
        <div className="pf-game-t">v {m.opponentHref ? <Link href={m.opponentHref} className="vbt-link">{m.opponent}</Link> : m.opponent}</div>
        <div className="pf-game-v">{[m.round, m.sets, m.status === "live" && "Live"].filter(Boolean).join(" · ")}</div>
      </div>
      <span className="pf-game-t" style={{ whiteSpace: "nowrap" }}>
        {m.href ? <Link href={m.href} className="vbt-link">{result ?? "Match page"}</Link> : result}
      </span>
    </div>
  );
}

export default async function VolleyballTeamPage({ params }: { params: Params }) {
  const { id: segment, teamId } = await params;
  const got = await load(segment, teamId);
  if (!got) notFound();
  const { tournament, profile } = got;
  if (tournament.slug && segment !== tournament.slug) redirect(`${tournamentPath(tournament)}/teams/${teamId}`);
  const { team, record, results, upcoming, roster } = profile;
  const base = tournamentPath(tournament);
  const captain = roster?.find((p) => p.role === "captain");
  let section = 0;
  const num = () => String(++section).padStart(2, "0");
  const anyFigures = roster?.some((p) => p.points !== null);

  return (
    <div className="pf">
      <div className="pf-wrap">
        <Link href={`${base}?tab=teams`} className="pf-back"><ChevronLeft size={15} /> {tournament.name}</Link>
        <div className="pf-eyebrow" style={{ marginTop: 22 }}>
          Team <span className="sep" /> Volleyball
          {team.group_name ? <><span className="sep" /> Group {team.group_name}</> : null}
        </div>
        <div className="pf-hero">
          <h1 className="pf-name">{team.name}</h1>
          {team.logo_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img className="pf-avatar" src={team.logo_url} alt={team.name} />
            : <div className="pf-avatar">{team.name.charAt(0).toUpperCase()}</div>}
        </div>
        <div className="pf-meta">
          {team.club_name ? <span>{team.club_name}</span> : null}
          {captain ? <span>Captain: {captain.name}</span> : null}
          {team.coach_name ? <span>Coach: {team.coach_name}</span> : null}
          <span>{tournament.name}</span>
        </div>

        <div className="pf-stats">
          <div className="pf-stat"><div className="pf-stat-v">{record.played}</div><div className="pf-stat-l">Played</div></div>
          <div className="pf-stat"><div className="pf-stat-v">{record.won}</div><div className="pf-stat-l">Won</div></div>
          <div className="pf-stat"><div className="pf-stat-v">{record.lost}</div><div className="pf-stat-l">Lost</div></div>
          <div className="pf-stat"><div className="pf-stat-v">{record.setsWon}–{record.setsLost}</div><div className="pf-stat-l">Sets</div></div>
        </div>

        <section className="pf-sec">
          <div className="pf-sec-head"><span className="pf-sec-num">{num()}</span><h2 className="pf-sec-t">Squad</h2>{roster ? <span className="pf-sec-count">{roster.length}</span> : null}</div>
          {!roster ? (
            <div className="pf-empty"><Link href={`/login?redirect=${encodeURIComponent(`${base}/teams/${teamId}`)}`} className="vbt-link" style={{ fontWeight: 700 }}>Sign in</Link> to see the squad.</div>
          ) : !roster.length ? <div className="pf-empty">No roster on file yet.</div> : roster.map((p) => (
            <Link key={p.id} href={`${base}/players/${p.id}`} className="pf-game" style={{ color: "inherit", textDecoration: "none" }}>
              <span className="pf-game-date">{p.number !== null ? `#${p.number}` : "–"}</span>
              <div>
                <div className="pf-game-t">{p.name}{p.role === "captain" ? " (captain)" : ""}{p.role === "substitute" ? " (sub)" : ""}</div>
                <div className="pf-game-v">{[p.position, p.points !== null && [`${p.kills} kills`, `${p.aces} aces`, `${p.blocks} blocks`, `${p.digs} digs`, `${p.assists} assists`].join(" · ")].filter(Boolean).join(" · ")}</div>
              </div>
              {anyFigures ? <span className="pf-game-t" style={{ whiteSpace: "nowrap" }}>{p.points !== null ? `${p.points} pts` : <span style={{ color: "var(--pf-faint)" }}>–</span>}</span> : null}
            </Link>
          ))}
        </section>

        {upcoming.length ? (
          <section className="pf-sec">
            <div className="pf-sec-head"><span className="pf-sec-num">{num()}</span><h2 className="pf-sec-t">Upcoming matches</h2></div>
            {upcoming.map((m) => <MatchLine key={m.id} m={m} />)}
          </section>
        ) : null}

        <section className="pf-sec">
          <div className="pf-sec-head"><span className="pf-sec-num">{num()}</span><h2 className="pf-sec-t">Results</h2></div>
          {results.length ? results.map((m) => <MatchLine key={m.id} m={m} />) : <div className="pf-empty">No results yet.</div>}
        </section>

        <div className="pf-trustline">
          <span>Sportonica · {tournament.name}</span>
          <Link href={`${base}?tab=table`} className="vbt-link">Tournament table</Link>
        </div>
      </div>
    </div>
  );
}
