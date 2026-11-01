"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MapPin, Search, Trophy } from "lucide-react";
import type { VolleyballDiscovery, VolleyballMatchCard, VolleyballTournamentCard } from "@/lib/intelligence/volleyballPublic";
import "@/app/tournaments/tournament-cards.css";
import "./volleyball.css";

const FILTERS = ["All", "Live", "Upcoming", "Completed", "Tournaments"] as const;
type Filter = (typeof FILTERS)[number];

const when = (iso: string | null) => iso
  ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kathmandu" })
  : "Date to be announced";

const isDone = (m: VolleyballMatchCard) => m.status === "completed" || m.status === "walkover";

function Crest({ name, url }: { name: string; url: string | null }) {
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img className="vbp-crest" src={url} alt="" /> : <span className="vbp-crest">{name.charAt(0).toUpperCase()}</span>;
}

function MatchRow({ m }: { m: VolleyballMatchCard }) {
  const scored = m.scoreA !== null && m.scoreB !== null;
  return (
    <Link href={m.href} className="vbp-match">
      <div className="vbp-match-top">
        <span className="vbp-match-t">{[m.tournamentName, m.round].filter(Boolean).join(" · ")}</span>
        {m.live ? <span className="vbp-live"><i aria-hidden="true" /> Live</span>
          : m.status === "walkover" ? <span className="vbp-tag">Walkover</span>
          : isDone(m) ? <span className="vbp-tag">Completed</span>
          : <span className="vbp-when">{when(m.startsAt)}</span>}
      </div>
      {(["a", "b"] as const).map((x) => (
        <div key={x} className={`vbp-side${m.winner === x ? " won" : ""}`}>
          <Crest name={x === "a" ? m.teamA : m.teamB} url={x === "a" ? m.logoA : m.logoB} />
          <span className="vbp-side-n">{x === "a" ? m.teamA : m.teamB}</span>
          {scored ? <b>{x === "a" ? m.scoreA : m.scoreB}</b> : null}
        </div>
      ))}
      {m.sets.length ? <div className="vbp-sets">{m.sets.map((g) => `${g.a}–${g.b}`).join(" | ")}</div> : null}
    </Link>
  );
}

function TournamentCard({ t }: { t: VolleyballTournamentCard }) {
  const live = t.status === "live", completed = t.status === "completed";
  const hasImg = t.bannerUrl && /^https?:\/\//i.test(t.bannerUrl);
  return (
    <Link href={t.href} className="tc-card" data-completed={completed} data-live={live} style={{ ["--tc-accent" as string]: "#3b82f6" }}>
      <div className="tc-media">
        {hasImg ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="tc-media-bg" src={t.bannerUrl!} alt="" aria-hidden="true" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="tc-media-fg" src={t.bannerUrl!} alt="" loading="lazy" />
          </>
        ) : <div className="tc-media-empty"><Trophy size={30} /></div>}
        <span className={`tc-status${completed ? " done" : live ? " live" : ""}`}>
          {completed ? "Completed" : live ? <><span className="tc-live-dot" aria-hidden="true" /> Live</> : <><Trophy size={11} /> Tournament</>}
        </span>
      </div>
      <div className="tc-body">
        <span className="tc-sport">Volleyball</span>
        <h3 className="tc-title">{t.name}</h3>
        {t.organizer ? <div className="tc-org">By {t.organizer}</div> : null}
        <div className="tc-loc"><MapPin size={13} /><span>{t.venue}</span></div>
        <div className={`tc-date${t.startsAt ? "" : " tbd"}`}>{when(t.startsAt)}</div>
      </div>
    </Link>
  );
}

export default function VolleyballClient({ data }: { data: VolleyballDiscovery }) {
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const has = (...parts: (string | null | undefined)[]) => !q || parts.some((p) => p?.toLowerCase().includes(q));

  // a player's or team's name also finds the tournament they play in
  const shown = useMemo(() => {
    const matches = data.matches.filter((m) => has(m.teamA, m.teamB, m.tournamentName, m.venue));
    const teams = data.teams.filter((t) => has(t.name, t.tournamentName));
    const players = data.players.filter((p) => has(p.name, p.teamName, p.tournamentName));
    const linked = new Set([...matches.map((m) => m.tournamentName), ...teams.map((t) => t.tournamentName), ...players.map((p) => p.tournamentName)]);
    const tournaments = data.tournaments.filter((t) => has(t.name, t.venue, t.organizer) || linked.has(t.name));
    return { matches, teams, players, tournaments };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, q]);

  const live = shown.matches.filter((m) => m.live);
  const upcoming = shown.matches.filter((m) => !m.live && !isDone(m)).sort((a, b) => (a.startsAt ?? "9999").localeCompare(b.startsAt ?? "9999"));
  const recent = shown.matches.filter(isDone).sort((a, b) => (b.startsAt ?? "").localeCompare(a.startsAt ?? ""));
  const show = (f: Filter) => filter === "All" || filter === f;
  const nothing = !shown.tournaments.length && !shown.matches.length;

  return (
    <div className="play tourn-page">
      <div className="play-wrap vbp">
      <div className="play-hero">
        <h1>Volleyball <em>& results.</em></h1>
        <p>Tournaments, live scores and results from across Sportonica.</p>
      </div>

      <label className="vbp-search">
        <Search size={16} aria-hidden="true" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tournaments, teams, players or venues" aria-label="Search volleyball" />
      </label>
      <div className="tourn-filters">
        {FILTERS.map((f) => <button key={f} type="button" className={`tourn-chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>{f}</button>)}
      </div>

      {nothing ? (
        <div className="vbp-empty">
          <h3>{q ? "Nothing matches that search" : "No volleyball tournaments right now"}</h3>
          <p>{q ? "Try a team, player or venue name." : "Once one is listed, it will show up here."}</p>
        </div>
      ) : null}

      {show("Live") && live.length ? <section className="vbp-sec"><h2>Live now</h2><div className="vbp-matches">{live.map((m) => <MatchRow key={m.id} m={m} />)}</div></section> : null}
      {filter === "Live" && !live.length && !nothing ? <div className="vbp-empty"><p>No matches are live right now.</p></div> : null}

      {show("Tournaments") && shown.tournaments.length ? (
        <section className="vbp-sec"><h2>{filter === "All" ? "Featured tournaments" : "Tournaments"}</h2>
          <div className="tourn-grid">{shown.tournaments.map((t) => <TournamentCard key={t.id} t={t} />)}</div>
        </section>
      ) : null}

      {show("Upcoming") && upcoming.length ? <section className="vbp-sec"><h2>Upcoming matches</h2><div className="vbp-matches">{(filter === "All" ? upcoming.slice(0, 6) : upcoming).map((m) => <MatchRow key={m.id} m={m} />)}</div></section> : null}
      {filter === "Upcoming" && !upcoming.length && !nothing ? <div className="vbp-empty"><p>No matches are scheduled.</p></div> : null}

      {show("Completed") && recent.length ? <section className="vbp-sec"><h2>Recent results</h2><div className="vbp-matches">{(filter === "All" ? recent.slice(0, 6) : recent).map((m) => <MatchRow key={m.id} m={m} />)}</div></section> : null}
      {filter === "Completed" && !recent.length && !nothing ? <div className="vbp-empty"><p>No results yet.</p></div> : null}

      {filter === "All" && shown.teams.length ? (
        <section className="vbp-sec"><h2>Leading teams</h2>
          <div className="vbp-list">{shown.teams.slice(0, 6).map((t) => (
            <Link key={t.id} href={t.href} className="vbp-row">
              <Crest name={t.name} url={t.logoUrl} />
              <span className="vbp-row-main"><b>{t.name}</b><small>{t.tournamentName}</small></span>
              <span className="vbp-row-v">{t.won}–{t.lost}</span>
            </Link>
          ))}</div>
        </section>
      ) : null}

      {filter === "All" && shown.players.length ? (
        <section className="vbp-sec"><h2>Top players</h2>
          <p className="vbp-note">Points are kills + blocks + aces, from matches where player figures were recorded.</p>
          <div className="vbp-list">{shown.players.slice(0, 6).map((p) => (
            <Link key={p.id} href={p.href ?? "#"} className="vbp-row">
              <span className="vbp-crest">{p.name.charAt(0).toUpperCase()}</span>
              <span className="vbp-row-main"><b>{p.name}</b><small>{[p.teamName, p.tournamentName].filter(Boolean).join(" · ")}</small></span>
              <span className="vbp-row-v">{p.points} pts</span>
            </Link>
          ))}</div>
        </section>
      ) : null}

      <div className="vbp-book"><Link href="/create?sport=Volleyball">Book a volleyball court</Link></div>
      </div>
    </div>
  );
}
