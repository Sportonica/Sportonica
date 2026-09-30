import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { listTournaments } from "@/lib/play/tournaments";
import TournamentsClient from "./TournamentsClient";
import "@/app/(play)/play.css";
import "@/components/home/rails.css";

// Public browse data — global, non-personalised. The page is rendered per
// request (CSP nonce, see src/app/layout.tsx), so cache the list itself
// and refresh it every 2 minutes rather than querying per hit.
const listCachedTournaments = unstable_cache(listTournaments, ["tournaments-list"], { revalidate: 120 });

export const metadata: Metadata = {
  title: "Tournaments · Sportonica",
  description: "Organised tournaments and events run by venues and by Sportonica. Join and pay the same way you book a game.",
};

export default async function TournamentsPage() {
  const items = await listCachedTournaments();
  return <TournamentsClient items={items} />;
}
