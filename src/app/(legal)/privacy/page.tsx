import Link from "next/link";
import type { Metadata } from "next";
import "../../(play)/play.css";

export const metadata: Metadata = {
  title: "Privacy Policy — Sportonica",
  description: "How Sportonica collects, uses, and protects your data.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="play has-sitenav">
      <div className="play-wrap" style={{ maxWidth: 760 }}>
        <div className="bk-panel">
          <h1 style={{ fontSize: 28, marginBottom: 6 }}>Privacy Policy</h1>
          <p className="hint" style={{ marginBottom: 28 }}>Last updated: 2 October 2026</p>
          <style>{`.legal-sec ul { padding-left: 20px; margin: 8px 0; } .legal-sec li { margin-bottom: 6px; } .legal-sec p { margin-bottom: 8px; }`}</style>

          <div className="legal-sec" style={{ fontSize: 14, lineHeight: 1.65, color: "var(--dim)", marginBottom: 8 }}>
            <p>
              We, <b>Sport Onica Pvt. Ltd.</b>, including our associates, authorized personnel, partners,
              and successors (&quot;Company&quot;, &quot;we&quot;, &quot;us&quot;, and &quot;our&quot;), are
              fully committed to respecting the privacy of every person who shares or has shared their
              personal information with us, whether through the Sportonica website and/or the mobile
              application. This policy sets out the types of information we collect from your use of
              Sportonica or our services, and how we collect, use, maintain, protect, and disclose that
              information. &quot;You&quot; refers to users of Sportonica or its services, whether or not you
              complete a transaction on the platform.
            </p>
          </div>

          <Section title="Acceptance">
            <p>
              The website and the Sportonica app, either directly or via licenses assigned by us, are
              jointly referred to as &quot;Sport Onica&quot;. By downloading, installing, accessing, using,
              or providing us with your information on Sportonica in any manner, you agree to be legally
              bound by this policy and the Terms of Use referenced within it. If you do not agree with any
              part of this Privacy Policy, please discontinue accessing or using Sportonica immediately.
            </p>
            <p>
              This policy is subject to modification at any time. We&apos;ll let you know when it changes,
              and you may be asked to provide fresh consent to the updated terms. If you don&apos;t agree
              with a change, please discontinue using Sportonica. You are providing your information to us
              of your own free will; do not submit any data you&apos;re not comfortable sharing under this
              policy.
            </p>
          </Section>

          <Section title="Information we collect">
            <p>Depending on how you use Sportonica, we collect:</p>
            <ul>
              <li><b>Account details:</b> your name, username, email address and/or phone number, and your password (stored only as a secure hash by our authentication provider). If you sign in with Google or Apple, we receive your name, email address, and profile photo from that provider.</li>
              <li><b>Profile details you choose to add:</b> profile photo, bio, city, and favourite sports.</li>
              <li><b>Bookings and payments:</b> the venues, courts, games, and tournaments you book or join; amounts, payment method, status, dates, and transaction IDs; and any payment screenshots you upload for verification.</li>
              <li><b>Photos you upload:</b> profile photos, payment screenshots, and, for venue owners and organisers, venue photos, team logos, tournament banners, and payment QR codes.</li>
              <li><b>Messages and content:</b> direct messages, group chats and polls, and the games, teams, events, and tournaments you create.</li>
              <li><b>Information about other people you add:</b> for example, the name and phone number or email of a walk-in player an organiser adds to a team.</li>
              <li><b>Device information:</b> a push-notification token for your device (mobile app only), and your IP address, which we use to limit abuse such as repeated failed sign-ins.</li>
            </ul>
            <p>
              We don&apos;t collect your gender, age, biometric data, or health information, and we don&apos;t
              use analytics, advertising, or tracking SDKs.
            </p>
          </Section>

          <Section title="Data collection">
            <p>
              You&apos;re required to provide certain personal and contact details to create and maintain
              your Sportonica account; the exact information required may vary based on how you interact
              with the platform. We also collect and process information you voluntarily submit or make
              available on Sportonica, including profile details, listings, requirements, feedback,
              communications, or other user-generated content.
            </p>
            <p>
              <b>Location.</b>{" "}If you allow it, the app reads your device&apos;s location to show how far
              venues and games are from you and to sort them by distance. That location is used only on
              your device: it isn&apos;t sent to or stored on our servers. You can turn it off at any time
              in your device or browser settings; everything else keeps working.
            </p>
            <p>
              <b>Push notifications.</b>{" "}If you allow notifications in the mobile app, we store a
              notification token for your device so we can send you updates about your bookings, games,
              groups, payments, and tournaments. The token is removed when you sign out, and you can turn
              notifications off at any time in your device settings.
            </p>
            <p>
              <b>Messages.</b>{" "}We don&apos;t access your device&apos;s contact list. We reserve the right
              to review conversations between users or service providers on Sportonica where needed to
              prevent abuse, protect users&apos; rights, and help settle disputes.
            </p>
            <p>
              <b>Payments.</b>{" "}Payments are made directly through third-party providers such as eSewa
              and Khalti, or to the venue. We never see or store your bank or card details. We keep the
              payment record (amount, method, status, date, transaction ID) and any screenshot you upload
              so the payment can be verified and for accounting.
            </p>
            <p>
              We adopt reasonable security measures and procedures to protect the personal data you supply,
              in compliance with applicable legislation, and we will not disclose or transfer your
              information to third parties without your explicit consent, except where disclosure is
              legally required or authorized by relevant legislation or government authorities.
            </p>
          </Section>

          <Section title="How we use your information">
            <p>We may collect, use, process, disclose, and transfer your personal information to:</p>
            <ul>
              <li>operate, maintain, and enhance the website and/or app;</li>
              <li>share with our affiliates, subsidiaries, and associated entities for legitimate business and operational purposes;</li>
              <li>support any corporate transaction, including a merger, acquisition, consolidation, restructuring, or transfer of business or assets;</li>
              <li>administer, perform, and enforce our contractual obligations and rights under any agreement entered into with you;</li>
              <li>comply with applicable legal and regulatory requirements, including responding to lawful requests, subpoenas, or court orders, and to establish, exercise, or defend legal claims;</li>
              <li>detect, investigate, prevent, or address fraud, security issues, unlawful activities, or violations of our Terms or policies, or as otherwise required or permitted by law;</li>
              <li>process and respond to your queries and understand your requirements;</li>
              <li>diagnose technical glitches and provide customer support;</li>
              <li>let you participate in interactive features offered through the Services; and</li>
              <li>send you notifications and emails about your account, bookings, games, and tournaments.</li>
            </ul>
            <p>We don&apos;t sell your personal information or use it for advertising.</p>
          </Section>

          <Section title="Who sees your information">
            <p>
              <b>Other users, when you use a feature.</b>{" "}When you book a venue or join a game, the venue
              owner or host sees your name and phone number for that booking. Team managers and tournament
              organisers see their team&apos;s roster. Your public profile (name, username, photo, and, if
              your profile is public, your bio, city, and stats) is visible to other users.
            </p>
            <p>
              <b>Service providers.</b>{" "}We use the following providers to run Sportonica. They process
              data only on our behalf:
            </p>
            <ul>
              <li><b>Supabase</b> — database, sign-in, and file storage</li>
              <li><b>Vercel</b> — website and app hosting</li>
              <li><b>Google Firebase Cloud Messaging</b> — delivering push notifications</li>
              <li><b>Brevo</b> — sending emails</li>
              <li><b>Cloudflare Turnstile</b> — protecting sign-up and sign-in from bots</li>
              <li><b>Google and Apple</b> — only if you choose to sign in with them</li>
              <li><b>CARTO</b> — map images (your browser requests map tiles from them directly)</li>
            </ul>
          </Section>

          <Section title="How long we keep your information">
            <p>
              We keep your information while your account is active. When you delete your account, your
              profile, email and phone, uploaded files, friends and messages, and notification tokens are
              deleted, and upcoming bookings are released. Past bookings, payment records, reviews, and
              other content are kept without your name or phone number, for accounting and legal reasons.
              See the{" "}
              <Link href="/account-deletion" style={{ color: "var(--sodium)", textDecoration: "underline", textUnderlineOffset: 2 }}>Account Deletion</Link>{" "}
              page for the full details.
            </p>
          </Section>

          <Section title="Disclosure &amp; authority">
            <p>
              We may disclose your information, without prior notice, where required to comply with
              applicable law, regulation, subpoena, court order, or other legal process. We may also
              disclose information (including, without limitation, your name, contact details, location,
              and activity on Sportonica) to law enforcement agencies or other governmental authorities,
              where required by law or in good-faith cooperation with an official investigation or
              proceeding.
            </p>
            <p>
              We may also strip out personally identifiable information and use the remaining data for
              historical or statistical purposes. You consent that the collection, disclosure, storage,
              processing, and transfer of any personal information under this Policy shall not cause you
              loss or wrongful gain where it is used for the purposes stated here.
            </p>
          </Section>

          <Section title="Security">
            <p>
              We&apos;re dedicated to keeping your personal and confidential data secure against breach,
              misuse, or abuse, and have put reasonable security measures and procedures in place to
              protect it from unauthorized access, modification, exposure, or destruction. That said, we
              cannot guarantee the absolute security of your data even with these measures in place, and we
              disclaim liability for security breaches and actions taken by third parties who may come to
              know of your information. Some of our services may link to third-party websites; we&apos;re
              not liable for their security measures, and we will not be held liable for loss, damage, or
              unintentional misuse of your information caused by reasons beyond our reasonable control.
            </p>
          </Section>

          <Section title="Third-party apps and websites">
            <p>
              We, or other users or service providers, may display advertisements or link to third-party
              sites, applications, products, or services. These third parties are separate and independent
              from us and not under our control unless stated otherwise, and we make no representation or
              warranty about the accuracy, availability, or legality of content offered through them.
              Information you share with any third party is governed by that third party&apos;s own privacy
              policy.
            </p>
          </Section>

          <Section title="Updating, deleting &amp; amending your information">
            <p>
              We make reasonable efforts to keep your data as accurate and current as possible, and will
              endeavor to give you access to it on request, and to let you correct, amend, delete, or
              destroy it where it&apos;s inaccurate, incomplete, outdated, no longer necessary for the
              purpose it was collected, or being used improperly. You may also request, in writing, the
              identities of any third parties your data has been disclosed to.
            </p>
            <p>
              These rights may be limited in some cases, for example, where exercising them would
              adversely affect another individual&apos;s rights, where the information is necessary for
              detecting criminal activity, or where disclosure could prejudice a negotiation or an ongoing
              investigation into suspected unlawful activity. Exercising your rights is also subject to
              applicable law.
            </p>
            <p>
              In practice: you can delete your account and its associated data yourself, any time, from{" "}
              <b>Profile → Login &amp; Security</b>. See our{" "}
              <Link href="/account-deletion" style={{ color: "var(--sodium)", textDecoration: "underline", textUnderlineOffset: 2 }}>Account Deletion</Link>{" "}
              page for exactly what&apos;s removed. For anything else, contact us below.
            </p>
          </Section>

          <Section title="Contact us">
            <p>
              For queries, reports, comments, or concerns about our privacy practices and this policy,
              email us at{" "}
              <a href="mailto:info@sportonica.com" style={{ color: "var(--sodium)", textDecoration: "underline", textUnderlineOffset: 2 }}>info@sportonica.com</a>,
              or write to:
            </p>
            <p>
              Sport Onica Pvt. Ltd.<br />
              Kathmandu Metropolitan City, Ward no. 9<br />
              Kathmandu District, Nepal
            </p>
          </Section>

          <p className="hint legal-foot" style={{ marginTop: 28 }}>
            <Link href="/terms">Terms of Service</Link> · <Link href="/">← Back to Sportonica</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 26 }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>{title}</h2>
      <div className="legal-sec" style={{ fontSize: 14, lineHeight: 1.65, color: "var(--dim)" }}>
        {children}
      </div>
    </section>
  );
}
