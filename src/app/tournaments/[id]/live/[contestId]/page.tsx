import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { getViewerId, runAsSignedOutVisitor } from "@/lib/supabase/server";
import { getTournament } from "@/lib/tournaments/actions";
import { canScoreTournament, getContest } from "@/lib/intelligence/actions";
import { isActionError } from "@/lib/actionError";
import { tournamentPath } from "@/lib/tournaments/types";
import MatchCentre from "@/components/intelligence/MatchCentre";
import CricketMatchCentre from "@/components/intelligence/cricket/CricketMatchCentre";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string; contestId: string }>;

// Signed-out spectators all see the same match, so read it once and share
// it for 15 s instead of per visit. Signed-in viewers (scorers,
// organisers) read live. A failed read throws, so it's never what's cached.
const getSignedOutMatch = unstable_cache(
  (segment: string, contestId: string) => runAsSignedOutVisitor(async () => {
    const [tournament, contest] = await Promise.all([getTournament(segment), getContest(contestId)]);
    if (isActionError(tournament)) throw new Error(tournament.message);
    if (isActionError(contest)) throw new Error(contest.message);
    return { tournament, contest };
  }),
  ["match-centre-signed-out"],
  { revalidate: 15 },
);

// once per request: the title and the page both need it
const loadMatch = cache(async (segment: string, contestId: string) => {
  if (!(await getViewerId())) {
    const shared = await getSignedOutMatch(segment, contestId).catch(() => null);
    if (shared) return { ...shared, canScore: false };
  }
  const tournament = await getTournament(segment);
  const id = isActionError(tournament) || !tournament ? null : tournament.id;
  const [contest, canScore] = await Promise.all([getContest(contestId), id ? canScoreTournament(id) : false]);
  return { tournament, contest: isActionError(contest) ? null : contest, canScore };
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id: segment, contestId } = await params;
  const { contest } = await loadMatch(segment, contestId);
  return { title: !contest ? "Match centre" : `${contest.label ?? "Match centre"} | Sportonica` };
}

export default async function MatchCentrePage({ params }: { params: Params }) {
  const { id: segment, contestId } = await params;
  const { tournament, contest, canScore } = await loadMatch(segment, contestId);
  if (isActionError(tournament) || !tournament) notFound();
  if (tournament.slug && segment !== tournament.slug) redirect(`${tournamentPath(tournament)}/live/${contestId}`);
  if (!contest || contest.tournamentId !== tournament.id) notFound();
  // cricket has its own match centre: scorecard, commentary and the chase
  if (contest.sport === "cricket") return <CricketMatchCentre initial={contest} tournamentName={tournament.name} canScore={canScore} />;
  return <MatchCentre initial={contest} tournamentName={tournament.name} canScore={canScore} />;
}
