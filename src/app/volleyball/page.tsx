import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { getVolleyballDiscovery } from "@/lib/intelligence/volleyballPublic";
import VolleyballClient from "./VolleyballClient";
import "@/app/(play)/play.css";
import "@/components/home/rails.css";

// Public and the same for everyone, so read once a minute rather than per
// visit. A failed read throws, so it's never what's cached.
const getCached = unstable_cache(getVolleyballDiscovery, ["volleyball-discovery"], { revalidate: 60 });

export const metadata: Metadata = {
  title: "Volleyball · Sportonica",
  description: "Volleyball tournaments, live scores, results and leaders on Sportonica.",
};

export default async function VolleyballPage() {
  const data = await getCached();
  return <VolleyballClient data={data} />;
}
