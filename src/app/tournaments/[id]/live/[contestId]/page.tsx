import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getTournament } from "@/lib/tournaments/actions";
import { canScoreTournament, getContest } from "@/lib/intelligence/actions";
import { isActionError } from "@/lib/actionError";
import { tournamentPath } from "@/lib/tournaments/types";
import MatchCentre from "@/components/intelligence/MatchCentre";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string; contestId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { contestId } = await params;
  const contest = await getContest(contestId);
  return { title: isActionError(contest) ? "Match centre" : `${contest.label ?? "Match centre"} | Sportonica` };
}

export default async function MatchCentrePage({ params }: { params: Params }) {
  const { id: segment, contestId } = await params;
  const tournament = await getTournament(segment);
  if (isActionError(tournament) || !tournament) notFound();
  if (tournament.slug && segment !== tournament.slug) redirect(`${tournamentPath(tournament)}/live/${contestId}`);
  const id = tournament.id;
  const [contest, canScore] = await Promise.all([getContest(contestId), canScoreTournament(id)]);
  if (isActionError(contest) || contest.tournamentId !== id) notFound();
  return <MatchCentre initial={contest} tournamentName={tournament.name} canScore={canScore} />;
}
