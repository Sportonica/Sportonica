import { notFound, redirect } from "next/navigation";
import { getTournament } from "@/lib/tournaments/actions";
import { canScoreTournament, getContest } from "@/lib/intelligence/actions";
import { isActionError } from "@/lib/actionError";
import ScorerConsole from "@/components/intelligence/ScorerConsole";

export const dynamic = "force-dynamic";

export default async function ScorerPage({ params }: { params: Promise<{ id: string; contestId: string }> }) {
  const { id, contestId } = await params;
  const [tournament, contest, canScore] = await Promise.all([getTournament(id), getContest(contestId), canScoreTournament(id)]);
  if (isActionError(tournament) || !tournament) notFound();
  if (isActionError(contest) || contest.tournamentId !== id) notFound();
  // anyone may watch; only whoever manages the tournament may score
  if (!canScore) redirect(`/tournaments/${id}/live/${contestId}`);
  return <ScorerConsole initial={contest} tournamentName={tournament.name} />;
}
