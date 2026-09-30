import { notFound, redirect } from "next/navigation";
import { getTeamRoster, getTournament, getTournamentMatches, listTournamentTeams } from "@/lib/tournaments/actions";
import { canScoreTournament, getScoringRules, listTournamentContests } from "@/lib/intelligence/actions";
import { sportKeyFor } from "@/lib/intelligence/registry";
import { isActionError } from "@/lib/actionError";
import ScorerHub, { type HubTeam } from "@/components/intelligence/ScorerHub";

export const dynamic = "force-dynamic";

export default async function ScorerHubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tournament = await getTournament(id);
  if (isActionError(tournament) || !tournament) notFound();
  // If the tables are missing, say so rather than bouncing the organizer away.
  const probe = await listTournamentContests(id);
  if (isActionError(probe) && probe.message.includes("db/sports_intelligence.sql")) {
    return <div className="play"><div className="play-wrap" style={{ maxWidth: 720, padding: 24 }}><h1>Live scoring</h1><p>{probe.message}</p></div></div>;
  }
  if (!(await canScoreTournament(id))) redirect(`/tournaments/${id}`);

  const sport = sportKeyFor(tournament.sport);
  const [matches, teamsRes, contests, rules] = await Promise.all([
    getTournamentMatches(id), listTournamentTeams(id), listTournamentContests(id), getScoringRules(id),
  ]);
  const confirmed = (isActionError(teamsRes) ? [] : teamsRes).filter((t) => t.status === "confirmed");
  // rosters are only needed to enter swimmers into lanes
  const rosters = sport === "swimming" ? await Promise.all(confirmed.map((t) => getTeamRoster(t.id))) : [];
  const teams: HubTeam[] = confirmed.map((t, i) => {
    const r = rosters[i];
    return { id: t.id, name: t.name, players: r && !isActionError(r) ? r.map((p) => ({ id: p.id, name: p.name, userId: p.user_id })) : [] };
  });

  return (
    <ScorerHub
      tournamentId={id} tournamentName={tournament.name} sportName={tournament.sport} sport={sport}
      matches={isActionError(matches) ? [] : matches} teams={teams}
      contests={isActionError(contests) ? [] : contests}
      rules={rules && !isActionError(rules) ? rules.rules : null}
    />
  );
}
