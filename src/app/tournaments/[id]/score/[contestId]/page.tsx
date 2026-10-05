import { notFound, redirect } from "next/navigation";
import { getTournament } from "@/lib/tournaments/actions";
import { canScoreTournament, getContest } from "@/lib/intelligence/actions";
import { isActionError } from "@/lib/actionError";
import { tournamentPath } from "@/lib/tournaments/types";
import ScorerConsole from "@/components/intelligence/ScorerConsole";

export const dynamic = "force-dynamic";

export default async function ScorerPage({ params }: { params: Promise<{ id: string; contestId: string }> }) {
  const { id: segment, contestId } = await params;
  const tournament = await getTournament(segment);
  if (isActionError(tournament) || !tournament) notFound();
  if (tournament.slug && segment !== tournament.slug) redirect(`${tournamentPath(tournament)}/score/${contestId}`);
  const id = tournament.id;
  const [contest, canScore] = await Promise.all([getContest(contestId), canScoreTournament(id)]);
  if (isActionError(contest) || contest.tournamentId !== id) notFound();
  // anyone may watch; only whoever manages the tournament may score
  if (!canScore) redirect(`${tournamentPath(tournament)}/live/${contestId}`);
  return <ScorerConsole initial={contest} tournamentName={tournament.name} />;
}
