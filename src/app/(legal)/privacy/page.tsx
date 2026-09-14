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
          <p className="hint" style={{ marginBottom: 28 }}>Last updated: 2 September 2026</p>
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
              and you may be asked to provide fresh consent to the updated terms — if you don&apos;t agree
              with a change, please discontinue using Sportonica. You are providing your information to us
              of your own free will; do not submit any data you&apos;re not comfortable sharing under this
              policy.
            </p>
          </Section>

          <Section title="Sensitive personal data we collect (SPDI)">
            <p>Personal information we may collect from you includes:</p>
            <ul>
              <li>Name</li>
              <li>Phone number</li>
              <li>Gender</li>
              <li>Email</li>
              <li>Age</li>
              <li>Location</li>
              <li>Biometric information</li>
              <li>Banking and payment information (subscription and payment-gateway-related information)</li>
              <li>Medical history, if any</li>
              <li>Data usage</li>
            </ul>
            <p>
              This also includes any of the above information received by a body corporate for processing,
              storing, or handling under a lawful contract or otherwise.
            </p>
          </Section>

          <Section title="Data collection">
            <p>
              You&apos;re required to provide certain personal and contact details to create and maintain
              your Sportonica account; the exact information required may vary based on how you interact
              with the platform. While creating an account, we collect information such as your email,
              phone number, name, age, address, and other demographic information reasonably required to
              facilitate the service. We may also collect and process any information you voluntarily
              submit or make available on Sportonica, including profile details, listings, requirements,
              feedback, communications, or other user-generated content.
            </p>
            <p>
              <b>Location.</b> If you&apos;ve enabled location-based services, we may collect your
              device&apos;s geographic location, including GPS and associated timestamps, to customize and
              improve the service. This data may be linked with your device identifier and other
              information we hold. You can opt out at any time by turning off location services on your
              device, though this may limit some functionality.
            </p>
            <p>
              <b>Contacts.</b> With your consent, we may ask for access to your device&apos;s contact list
              to implement certain features. Where access is granted, we collect and use contact
              information — name, phone number, and email — exclusively to implement those features. We
              reserve the right to monitor conversations between users or service providers facilitated
              through Sportonica, including to prevent abuse, protect users&apos; rights, and help settle
              disputes.
            </p>
            <p>
              <b>Payments.</b> Some sensitive personal data or information (SPDI), such as bank or
              credit/debit card details, may need to be submitted to complete transactions through our
              authorized payment gateways and financial institutions. The Company does not collect, access,
              or store this payment-related information on its own systems, except for audit or
              transaction record-keeping purposes — it is transmitted directly to, and processed by,
              third-party payment gateway providers integrated with Sportonica. We only engage payment
              service providers that adhere to industry-standard security protocols.
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
              <li>operate, maintain, and enhance the website and/or app, including analytics to improve functionality and user experience;</li>
              <li>share with our affiliates, subsidiaries, and associated entities for legitimate business and operational purposes;</li>
              <li>support any corporate transaction, including a merger, acquisition, consolidation, restructuring, or transfer of business or assets;</li>
              <li>administer, perform, and enforce our contractual obligations and rights under any agreement entered into with you;</li>
              <li>comply with applicable legal and regulatory requirements, including responding to lawful requests, subpoenas, or court orders, and to establish, exercise, or defend legal claims;</li>
              <li>detect, investigate, prevent, or address fraud, security issues, unlawful activities, or violations of our Terms or policies, or as otherwise required or permitted by law;</li>
              <li>process and respond to your queries and understand your requirements;</li>
              <li>diagnose technical glitches and provide customer support;</li>
              <li>let you participate in interactive features offered through the Services; and</li>
              <li>enable monetization and process statistics for advertising, affiliate marketing, and analytics.</li>
            </ul>
          </Section>

          <Section title="Disclosure &amp; authority">
            <p>
              We may disclose your information, without prior notice, where required to comply with
              applicable law, regulation, subpoena, court order, or other legal process. We may also
              disclose information — including, without limitation, your name, contact details, location,
              and activity on Sportonica — to law enforcement agencies or other governmental authorities,
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
              These rights may be limited in some cases — for example, where exercising them would
              adversely affect another individual&apos;s rights, where the information is necessary for
              detecting criminal activity, or where disclosure could prejudice a negotiation or an ongoing
              investigation into suspected unlawful activity. Exercising your rights is also subject to
              applicable law.
            </p>
            <p>
              In practice: you can delete your account and its associated data yourself, any time, from{" "}
              <b>Profile → Login &amp; Security</b> — see our{" "}
              <Link href="/account-deletion" style={{ color: "var(--sodium)" }}>Account Deletion</Link>{" "}
              page for exactly what&apos;s removed. For anything else, contact us below.
            </p>
          </Section>

          <Section title="Contact us">
            <p>
              For queries, reports, comments, or concerns about our privacy practices and this policy,
              email us at{" "}
              <a href="mailto:info@sportonica.com" style={{ color: "var(--sodium)" }}>info@sportonica.com</a>,
              or write to:
            </p>
            <p>
              Sport Onica Pvt. Ltd.<br />
              Kathmandu Metropolitan City, Ward no. 9<br />
              Kathmandu District, Nepal
            </p>
          </Section>

          <p className="hint" style={{ marginTop: 28 }}>
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
