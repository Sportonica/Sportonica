import { unstable_cache } from "next/cache";
import { getHomeRails } from "@/lib/play/homeRails";
import HomeClient from "./HomeClient";

// The homepage data (getHomeRails) is global and non-personalised — the
// per-city view is filtered client-side in HomeClient. The page itself is
// rendered per request (the CSP nonce needs that, see src/app/layout.tsx),
// so cache the data instead: one database round trip every 2 minutes,
// not one per visitor.
const getCachedHomeRails = unstable_cache(getHomeRails, ["home-rails"], { revalidate: 120 });

// Tells Google what kind of site this actually is, rather than leaving it
// to infer from unstructured page text — a WebSite/Organization pairing
// is the standard baseline for a local service platform like this.
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "name": "Sportonica",
      "url": process.env.NEXT_PUBLIC_SITE_URL || "https://www.sportonica.com",
      "logo": `${process.env.NEXT_PUBLIC_SITE_URL || "https://www.sportonica.com"}/icons/icon-512.png`,
      "areaServed": { "@type": "City", "name": "Kathmandu" },
    },
    {
      "@type": "WebSite",
      "name": "Sportonica",
      "url": process.env.NEXT_PUBLIC_SITE_URL || "https://www.sportonica.com",
      "description": "Book courts, join pickup games, and find your regular crew across Kathmandu.",
      "potentialAction": {
        "@type": "SearchAction",
        "target": `${process.env.NEXT_PUBLIC_SITE_URL || "https://www.sportonica.com"}/discover?q={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
  ],
};

// Server wrapper: fetches the rail data, then hands it to the (client)
// homepage so the animations and theme hooks keep working.
export default async function Page() {
  const rails = await getCachedHomeRails().catch(() => null);
  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <HomeClient rails={rails ?? undefined} />
    </>
  );
}
