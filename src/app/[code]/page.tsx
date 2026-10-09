import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { findCoupon } from "@/lib/coupons";
import Confetti from "@/components/Confetti";
import CopyCode from "./CopyCode";
import "./coupon.css";

// sportonica.com/<CODE>: a partner offer won through Sportonica. Every
// other route is a static folder and wins over this one; anything here
// that is not one of the codes is a plain 404.

export const dynamic = "force-dynamic";

// a code is a private link: keep it out of search results and link previews
export const metadata: Metadata = {
  title: "You've got a reward · Sportonica",
  robots: { index: false, follow: false },
};

export default async function CouponPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const found = await findCoupon(raw);
  if (!found) notFound();
  const { code, offer } = found;

  return (
    <main className="cp">
      <Confetti />
      <div className="cp-card">
        <p className="cp-kicker">Congratulations!</p>
        <h1 className="cp-title">You&apos;ve got <span>{offer.discount}</span> {offer.what}</h1>
        <p className="cp-at">at <b>{offer.partner}</b>, {offer.place}</p>

        <div className="cp-code">
          <span className="cp-code-label">Your coupon code</span>
          <span className="cp-code-value">{code}</span>
          <CopyCode code={code} />
        </div>

        <ol className="cp-steps">
          <li>Visit {offer.partner}, {offer.place}.</li>
          <li>Show this page or tell them the code before you pay.</li>
          <li>Get {offer.discount} {offer.what}.</li>
        </ol>
        <p className="cp-fine">This code is unique to you. Offer subject to {offer.partner}&apos;s terms.</p>

        <Link href="/" className="cp-home">Explore Sportonica</Link>
      </div>
    </main>
  );
}
