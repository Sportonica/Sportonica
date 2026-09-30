import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTournament } from "@/lib/tournaments/actions";
import { canScoreTournament, getContest } from "@/lib/intelligence/actions";
import { isActionError } from "@/lib/actionError";
import MatchCentre from "@/components/intelligence/MatchCentre";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string; contestId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { contestId } = await params;
  const contest = await getContest(contestId);
  return { title: isActionError(contest) ? "Match centre" : `${contest.label ?? "Match centre"} | Sportonica` };
}

export default async function MatchCentrePage({ params }: { params: Params }) {
  const { id, contestId } = await params;
  const [tournament, contest, canScore] = await Promise.all([getTournament(id), getContest(contestId), canScoreTournament(id)]);
  if (isActionError(tournament) || !tournament) notFound();
  if (isActionError(contest) || contest.tournamentId !== id) notFound();
  return <MatchCentre initial={contest} tournamentName={tournament.name} canScore={canScore} />;
}
