import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getMyProfile } from "@/lib/profile/queries";
import { smsEnabled } from "@/lib/phone/sms";
import { safeRedirect } from "@/lib/validation/redirect";
import VerifyPhoneStep from "./VerifyPhoneStep";
import "../../p/profile.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Verify your phone — Sportonica" };

// Where phone-signup accounts created before SMS codes existed land
// after signing in (SEC-03), until they confirm the number.
export default async function VerifyPhonePage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const next = safeRedirect((await searchParams).redirect ?? "/discover");
  const profile = await getMyProfile();
  if (!profile) redirect(`/login?redirect=${encodeURIComponent("/profile/verify-phone")}`);
  if (!smsEnabled() || profile.phone_verified_at) redirect(next);

  return (
    <div className="pf">
      <div className="pf-wrap" style={{ maxWidth: 520 }}>
        <h1 className="pf-hub-name" style={{ marginTop: 18 }}>Confirm your phone number</h1>
        <VerifyPhoneStep phone={profile.phone} next={next} />
      </div>
    </div>
  );
}
