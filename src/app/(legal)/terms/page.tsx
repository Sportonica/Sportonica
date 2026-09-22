import Link from "next/link";
import type { Metadata } from "next";
import "../../(play)/play.css";

export const metadata: Metadata = {
  title: "Terms of Service — Sportonica",
  description: "The terms that govern your use of the Sportonica platform.",
};

export default function TermsOfServicePage() {
  return (
    <div className="play has-sitenav">
      <div className="play-wrap" style={{ maxWidth: 760 }}>
        <div className="bk-panel">
          <h1 style={{ fontSize: 28, marginBottom: 6 }}>Terms of Service</h1>
          <p className="hint" style={{ marginBottom: 28 }}>Last updated: 2 September 2026</p>
          <style>{`.legal-sec ul { padding-left: 20px; margin: 8px 0; } .legal-sec li { margin-bottom: 6px; } .legal-sec p { margin-bottom: 8px; }`}</style>

          <div className="legal-sec" style={{ fontSize: 14, lineHeight: 1.65, color: "var(--dim)", marginBottom: 8 }}>
            <p>
              You have accessed our app and/or our website. The domain name Sportonica is owned by{" "}
              <b>Sport Onica Pvt. Ltd.</b>, a duly incorporated private company under the laws of Nepal
              (company registration no.: <i>pending, to be added</i>), with its registered address at
              Kathmandu Metropolitan City, Ward no. 9, Kathmandu District, Nepal. The website and app are
              internet-based portals owned and operated by Sport Onica Pvt. Ltd. (&quot;Company&quot;,
              &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;).
            </p>
          </div>

          <Section title="1. Introduction">
            <p>
              &quot;You&quot;, &quot;your&quot;, or &quot;User&quot; means the individual or entity
              accessing, using, or participating in Sportonica in any manner. If you use Sportonica on
              behalf of an entity, you represent that you have the authority to bind that entity to these
              Terms, and your acceptance is deemed acceptance on its behalf. &quot;User&quot; includes all
              users of the platform, including people browsing, individuals or family members obtaining or
              intending to obtain our services, venue owners, and anyone otherwise connected with or
              contributing to the use of the website, app, or the Services provided through it.
            </p>
            <p>
              These Terms of Use (&quot;Terms&quot;) govern your use of the Sportonica mobile application
              and any associated services (collectively, &quot;Sportonica&quot; or the &quot;Sportonica
              Platform&quot;). By downloading, installing, accessing, or using the Platform in any manner,
              you agree to be legally bound by these Terms and all policies incorporated by reference,
              including the{" "}
              <Link href="/privacy" style={{ color: "var(--sodium)", textDecoration: "underline", textUnderlineOffset: 2 }}>Privacy Policy</Link>. If you do not
              agree, please discontinue accessing or using Sportonica immediately.
            </p>
          </Section>

          <Section title="2. Amendment">
            <p>
              These Terms, and any document incorporated by reference, are subject to modification at any
              time. We may change, modify, add, or remove portions of these Terms at our sole discretion,
              without prior written notice. You&apos;re responsible for regularly reviewing the Terms and
              our other policies; you&apos;ll be informed of changes and may be asked for your consent to
              them. Failure to consent may result in termination of your registration. Any new features or
              tools added to the website and/or app are also subject to these Terms.
            </p>
          </Section>

          <Section title="3. Use of Platform Services">
            <p>
              You don&apos;t need to register to simply visit and view Sportonica, but you do need to
              register to access the Platform Services. Services are available only to persons competent to
              form a legally binding contract under Sections 32 and 33 of the Muluki Civil Code 2074, and
              not to anyone previously suspended or removed from Sportonica. Persons incompetent to contract
              under the Muluki Civil Code 2074 (including minors and people of unsound mind) are not
              eligible to use the website and/or app.
            </p>
            <p>
              You&apos;ll be required to submit your name, mobile number, and/or email address on the
              registration screen and create a password, authenticated by OTP verification and secure
              backend authentication. You may also register using an existing email account (e.g. Google
              sign-in).
            </p>
            <p>
              You represent that you&apos;re at least 18 years of age, that all registration information you
              submit is truthful and accurate, that you&apos;ll maintain its accuracy, and that your use of
              Sportonica doesn&apos;t violate any applicable law or regulation. Your account may be
              terminated without warning if we believe you&apos;re under 18 or not complying with applicable
              laws. If you&apos;re accessing Sportonica while under the authorized age, it&apos;s assumed
              your use was authorized and supervised by your parent or guardian.
            </p>
          </Section>

          <Section title="4. Use of the Services">
            <p>
              Sportonica is an online hybrid intermediary platform that supports and facilitates the
              discovery, availability-viewing, and booking of sports venues, and enables the aggregation of
              users into shared sports sessions and the coordinated scheduling of such events. Sportonica
              does not act as an event organizer, but enables game and event listings and facilitates player
              matching. We connect users with venue owners, who may host games or events independently.
              Sportonica does not own, operate, manage, or control any sports venue, and does not organize,
              conduct, supervise, or host any sports activity, event, or game.
            </p>
            <p>
              Sportonica merely provides a platform for users and venue owners to connect and coordinate
              bookings. All services are provided directly by venue owners or other users (&quot;Service
              Providers&quot;), and Sportonica is not a party to any transaction, arrangement, or
              interaction between users and venue owners.
            </p>
            <p>
              Registered venue owners or users may list venues and event details calling for participants.
              Users select the sport, venue, day, time, area, and other required information; discover
              venues; book listed facilities; and make payments. Venue owners set an availability schedule,
              pricing, and other requirements, and accept or manage bookings. A user may book an entire venue
              and list it for reservation by other users, or register for individual slots in a scheduled
              event, and may join scheduled games without booking the full venue. Games may be created by
              platform administrators, venue owners, vendors, or initiated by user demand. Fees are paid
              through the gateway/options on the website or app, per the listed fee structure; on receipt of
              payment we immediately provide a system-generated booking confirmation.
            </p>
            <p>
              Venue owners and service providers are expected to confirm bookings/registrations per their
              terms of engagement with us, and, once accepted, may not cancel or reschedule them unless
              permitted by that engagement or approved in advance in writing by us. Bookings may be put under
              review before acceptance, and we&apos;ll follow up on any non-acceptance. Venue owners agree to
              give preference to booking requests received through Sportonica.
            </p>
            <p>
              Sportonica is only a platform to register and/or book for Services, and is in no way
              responsible for the execution, performance, or non-performance of services by any Service
              Provider. We don&apos;t guarantee minimum participation, game completion, or the skill level or
              compatibility of players.
            </p>
          </Section>

          <Section title="5. General Terms of Use">
            <p>
              Bookings may be cancelled, modified, or rescheduled per Platform policies or venue owner terms.
              For shared games, bookings may be cancelled where sufficient participants aren&apos;t
              available. Refunds, where applicable, are governed by Platform policies, may be conditional,
              and aren&apos;t guaranteed in every case. We reserve the right to determine refund
              eligibility.
            </p>
            <p>
              It&apos;s your responsibility to treat your user ID, password, and any other information we
              provide as part of our security procedures as confidential, and not to disclose it to anyone
              other than us. We may, at our sole discretion, disable a user ID or password if you fail to
              comply with these Terms.
            </p>
            <p>
              Prices are customized depending on the services rendered, listed in Nepali currency, and are
              inclusive of tax. You may book or register for a service only on advance payment, unless the
              Service Provider explicitly states otherwise, and payment is only made through the payment
              gateways/modes available on the website or app.
            </p>
            <p>
              You&apos;re responsible for use of the Services through your device and for bringing these
              Terms and our policies to the attention of anyone else using it, and you&apos;re fully
              responsible for all activity through your account. You agree to:
            </p>
            <ul>
              <li>register in your own name only, keeping all account information accurate and up to date;</li>
              <li>not pass yourself off as someone else or create multiple or false accounts;</li>
              <li>promptly update your account information whenever it changes;</li>
              <li>not transfer your membership/registration to another person;</li>
              <li>immediately notify us of any unauthorized use of your account or breach of security; and</li>
              <li>immediately inform us if you believe your password is known to someone else, or that your account is being or is likely to be used without authorization.</li>
            </ul>
            <p>
              You may be held liable for any loss incurred by Sportonica or a third party from authorized or
              unauthorized use of your account, and agree to indemnify us for it.
            </p>
            <p>You acknowledge that we facilitate the coordinating and booking of sports events and venues listed by Service Providers, and that we do not:</p>
            <ul>
              <li>make any warranty, express or implied, about the quality of venues and events offered by Service Providers;</li>
              <li>endorse or confirm that a product, service, or event meets a certain quality as rated by reviews;</li>
              <li>assume liability if a product, service, event, or venue doesn&apos;t meet your expectations, or if you suffer loss or damage (including bodily injury) from using it;</li>
              <li>assume liability for a change, alteration, amendment, or replacement to services or event structure by a Service Provider; or</li>
              <li>guarantee minimum participation, event/game completion, or the skill level or compatibility of players.</li>
            </ul>
            <p>
              Sportonica is not equipped or authorized to conclude any financial transaction. All payments
              are made through the payment gateway. By providing payment details, you represent that
              they&apos;re correct and accurate and that you&apos;re authorized to use the designated payment
              gateway; an unverifiable, invalid, or unacceptable payment method may result in your request
              being suspended or cancelled. Your payment information won&apos;t be shared with third parties
              except for fraud verification or as required by law, regulation, or court order. You&apos;re
              solely responsible for the security and confidentiality of your own banking and payment card
              details, and we disclaim liability for their unauthorized use.
            </p>
            <p>
              We don&apos;t endorse any Service Provider, and while these Terms require you to provide
              accurate information, we don&apos;t attempt to confirm your purported identity. You agree not
              to seek any legal remedy from us for actions or omissions of a Service Provider.
            </p>
          </Section>

          <Section title="6. Terms of Usage">
            <p>Your use of Sportonica is strictly governed by the following binding principles. You agree not to:</p>
            <ul>
              <li>conduct systematic or automated data collection (scraping, data mining, extraction, harvesting, &apos;framing&apos;, article &apos;spinning&apos;) without our express written consent;</li>
              <li>reverse look-up, trace, or try to trace any other user, visitor, or customer&apos;s information to its source, or exploit the website/app or its information in any way not provided for by the platform;</li>
              <li>disrupt or interfere with the security of, or otherwise cause harm to, the website/app, its systems, resources, accounts, passwords, servers, or connected networks;</li>
              <li>make or publish negative, disparaging, or defamatory statements about the Company or its brand and domain names, or engage in conduct that could harm our reputation, tarnish or dilute our trademarks and goodwill, or impose an unreasonable burden on our infrastructure or systems;</li>
              <li>use the website/app or its content for any unlawful purpose, or to solicit illegal activity or activity that infringes Sportonica&apos;s or a third party&apos;s rights;</li>
              <li>falsify or delete author attributions, legal notices, or proprietary designations on uploaded material;</li>
              <li>attempt unauthorized access to any part of the website/app, connected systems or networks, or any Sportonica server, by hacking, password mining, or other illegitimate means;</li>
              <li>host, display, upload, download, modify, publish, transmit, or share content that belongs to someone else without right; is harmful, harassing, defamatory, obscene, pornographic, libelous, hateful, discriminatory, or otherwise unlawful; is misleading or misrepresentative; is patently offensive to the online community; harasses or advocates harassment; is junk mail, a chain letter, or spam; infringes a third party&apos;s IP, privacy, or publicity rights; contains hidden or password-only pages; provides instructions for illegal activity; engages in unauthorized commercial activity, gambling, or solicitation; interferes with another user&apos;s enjoyment of the Services; impersonates another person; or transmits viruses or corrupted files; and</li>
              <li>engage in any activity that threatens the unity, integrity, defense, security, or sovereignty of Nepal or friendly relations with foreign states, incites a criminal offence, obstructs investigation of one, is insulting to another nation, or is otherwise restricted or limited by prevailing law.</li>
            </ul>
            <p>
              You grant us a non-exclusive, worldwide, perpetual, irrevocable, royalty-free, and
              sublicensable license to use, reproduce, modify, adapt, publish, translate, distribute,
              publicly perform, and display any User Content you provide, and to exercise copyright,
              publicity, database, and other rights in it, for the purposes set out in these Terms and our
              Privacy Policy.
            </p>
            <p>
              We may monitor your messages and interactions on the Platform. If you engage in unauthorized
              advertising or solicitation, we may restrict the number of messages you can send within a
              24-hour period, or take other appropriate action. You authorize us to disclose your
              information (including your identity) to comply with applicable laws, regulations, legal
              process, or governmental requests, including in connection with investigations of alleged
              unlawful activity, court orders or subpoenas, or the investigation, prevention, or resolution
              of suspected illegal activity, particularly where there&apos;s a risk of harm or injury.
            </p>
            <p>
              You must at all times comply with the Electronic Transaction Act 2063, the Privacy Act 2075,
              and all other applicable domestic rules, laws, and regulations, and must not engage in any
              transaction prohibited by them.
            </p>
            <p>
              We reserve the right, but not the obligation, to monitor content posted on Sportonica, and may
              remove, modify, or disable access to content we determine or reasonably suspect violates
              applicable law or these Terms. You remain solely responsible for all content you post,
              including private communications; such content doesn&apos;t reflect our views, and we&apos;re
              not liable for claims, damages, or losses arising from it. You represent that you hold all
              necessary rights to any content you submit, and that it doesn&apos;t infringe any third
              party&apos;s rights or contain unlawful material.
            </p>
            <p>
              Any violation of these Terms or our other policies terminates the permission/consent granted
              to you, and we may, at our sole discretion, suspend or terminate your registration. Such a
              decision is final and binding.
            </p>
          </Section>

          <Section title="7. Intellectual property">
            <p>
              The website and/or app (including its underlying processes, arrangement, software, text,
              graphics, interfaces, audio elements, artwork, and code) is protected by applicable
              intellectual property rights, including copyright, design rights, database rights, and
              trademarks, all either owned by us or duly licensed for use in connection with the Services.
              Copying, reproduction, distribution, storage, framing, transmission, or commercial exploitation
              of any such material is strictly prohibited without our prior written consent.
            </p>
            <p>
              Sportonica owns or is licensed to use all intellectual property rights in the text, programs,
              products, processes, technology, content, software, and other materials made available on the
              platform, along with the trademark &quot;Sportonica&quot;. This includes all rights, title, and
              interest in the compilation of content, copyrights and related rights, patents, designs,
              know-how, trade secrets, inventions (including pending ones), goodwill, images, audio,
              downloads, databases, source code, meta tags, and all other materials made available on the
              Platform. The compilation itself (its collection, arrangement, and assembly) is our exclusive
              property.
            </p>
            <p>
              You agree not to sell, license, lease, modify, distribute, copy, reproduce, transmit, publicly
              display or perform, publish, adapt, edit, reverse engineer, create derivative works from,
              transfer, or otherwise exploit any content, information, or software obtained from Sportonica
              without our prior written authorization. You must not redistribute or republish any Platform
              material except where we&apos;ve specifically made it available for that purpose.
            </p>
            <p>
              We&apos;re not liable for infringement of copyright, trademark, or other proprietary rights
              arising from content posted, transmitted, or advertised by users. Any content you submit or
              post must be original to you, or you must hold all necessary rights, licenses, and consents to
              use it and permit its upload.
            </p>
            <p>
              By submitting or posting content, you irrevocably assign and transfer to Sportonica all
              rights, title, and interest in it, including present and future intellectual property rights (copyright,
              moral rights, and related rights) on a worldwide, perpetual, exclusive,
              royalty-free, and transferable basis, with no compensation payable by us. You don&apos;t
              acquire any rights in Sportonica or its group companies&apos; names, trademarks, designs,
              patents, copyrights, or other IP. You grant us the unrestricted right to use, reproduce,
              distribute, modify, adapt, create derivative works from, publish, display, and otherwise
              exploit such content in any format or media, in connection with our business, including for
              promotional and commercial purposes. We don&apos;t guarantee the confidentiality of any content
              submitted or posted on the Platform.
            </p>
          </Section>

          <Section title="8. Third-party content">
            <p>
              We can&apos;t guarantee that other users will comply with these Terms, and you assume all risk
              of loss, harm, or injury from another user&apos;s non-compliance. Any link that redirects you
              away from Sportonica leads to a destination that isn&apos;t controlled by us and may be
              governed by its own terms and privacy policy. We&apos;re not responsible or liable for the
              content, policies, or practices of external websites, and may disable links to or from
              third-party sites at our sole discretion. Please verify the accuracy of information yourself
              before relying on it.
            </p>
          </Section>

          <Section title="9. Breach of Terms">
            <p>
              We may, at our sole and absolute discretion and without obligation or prior notice, suspend,
              restrict, deactivate, or terminate your account, block your email or IP address, cancel or
              limit your access to Sportonica, or remove and discard content on the Platform
              (&quot;Termination&quot;), for any reason, including where we believe or have reasonable
              grounds to believe you&apos;ve violated these Terms or our policies. Upon termination, your
              right to participate in Sportonica ends automatically; your right to receive Services is
              conditional on your proper use of the Platform, adherence to these Terms, continued account
              activation, and permitted participation. Notice of termination is sent to the email you
              registered with, and takes effect immediately on delivery. We retain the right to use data
              collected from your use of Sportonica for internal analysis and archival purposes, and these
              Terms and our policies survive expiration or termination of your account or the Platform
              itself.
            </p>
            <p>
              You agree to indemnify, defend, and hold us harmless from losses, damages, costs, liabilities,
              and expenses (including reasonable legal fees) arising from your breach of these Terms, or any
              claim that you&apos;ve breached them.
            </p>
          </Section>

          <Section title="10. Indemnification and warranties">
            <p>
              You agree to release, defend, indemnify, and hold harmless the Company, its directors,
              shareholders, officers, and representatives from costs, damages, liabilities, or other
              consequences arising from the actions or conduct of Sportonica users, and you waive any claims
              you may have in that regard under applicable law. These limitations of liability and
              disclaimers extend to and benefit our officers, employees, agents, subsidiaries, successors,
              assigns, and subcontractors. We expressly disclaim, and you release us from, all liability for
              controversies, claims, suits, injuries, losses, harms, or damages arising from the Services or
              your interactions with other users, online or offline. All use of the Services is at your
              sole and exclusive risk.
            </p>
            <p>
              While we make reasonable efforts to maintain the integrity of Sportonica, we don&apos;t control
              and assume no responsibility for information made available by users, which may be inaccurate,
              misleading, offensive, or otherwise objectionable. Exercise appropriate caution and judgment
              when interacting with other users. You may report offensive or objectionable content, and we
              may remove or disable access to any content at our sole discretion; all content posted,
              including the views expressed in it, remains the sole responsibility of the user who posted
              it.
            </p>
            <p>
              We may, at any time and at our sole discretion, alter, modify, suspend, or discontinue the
              website/app in whole or in part, introduce or revise fees, or change what features are
              available to some or all users, without prior notice or liability.
            </p>
            <p>
              We make no representation or warranty about the accuracy, reliability, completeness, or
              timeliness of any content, information, software, or communication made available through
              Sportonica, and don&apos;t warrant uninterrupted or error-free operation. The Services are
              provided &quot;as is&quot; and &quot;as available&quot;, without warranties of any kind,
              express, implied, statutory, or otherwise, including implied warranties of merchantability,
              fitness for a particular purpose, or non-infringement.
            </p>
            <p>
              We don&apos;t assume responsibility for the privacy or security of email addresses,
              registration or identification information, storage space, communications, or other user
              content stored on our systems or transmitted over networks accessed through Sportonica. We
              don&apos;t employ, recommend, or endorse any user, have no control over any user&apos;s acts or
              omissions, and aren&apos;t responsible or liable for the performance or conduct of any user or
              third party, online or offline. We don&apos;t screen users or conduct identity or background
              checks except where expressly stated.
            </p>
            <p>
              We&apos;re not liable for injury, loss of life, or accident that may occur to any user, Service
              Provider, or third party while engaging in activities or availing services booked through
              Sportonica, and expressly disclaim all liability, direct or indirect, known or unknown,
              arising from the Services, including payments made to third-party Service Providers. By using
              Sportonica, you agree to indemnify and hold us harmless from claims, disputes, or damages
              arising from any disagreement between you and other users, Service Providers, or third
              parties.
            </p>
            <p>
              These Terms constitute a comprehensive limitation of liability for all forms of damages:
              direct, indirect, incidental, special, punitive, consequential, or exemplary, including loss of
              profits, goodwill, use, data, or other intangible losses, whether arising in contract or
              under applicable law, to the fullest extent permitted.
            </p>
            <p>
              You&apos;re solely responsible for ensuring compliance with all applicable statutes,
              enactments, rules, regulations, notifications, guidelines, and orders issued by any
              governmental authority, statutory body, tribunal, board, or court, whether within or outside
              the relevant jurisdiction, in connection with your access to and use of Sportonica, your use of
              its Services, and any content you post, upload, transmit, or disseminate through it, and to
              ensure your activities don&apos;t violate applicable law or any third party&apos;s rights.
            </p>
          </Section>

          <Section title="11. Severability">
            <p>
              If any provision of these Terms is found illegal, invalid, or unenforceable under the laws of
              any jurisdiction they&apos;re intended to apply in, that provision is deemed severed and
              ineffective to that extent within that jurisdiction, while the remaining provisions continue in
              full force and effect.
            </p>
          </Section>

          <Section title="12. Disclaimer">
            <p>
              We make reasonable efforts to keep information on Sportonica accurate and up to date, but
              don&apos;t warrant or represent the accuracy, completeness, reliability, or quality of any
              data, information, service, or content on the Platform. All materials are provided for general
              informational purposes only and shouldn&apos;t be relied on as the sole basis for
              decision-making. Any reliance is strictly at your own risk. We don&apos;t guarantee
              uninterrupted or error-free availability of the Platform and aren&apos;t responsible for
              non-availability due to scheduled maintenance, technical issues, or causes beyond our
              reasonable control. The internet isn&apos;t a secure medium, and we don&apos;t warrant that
              Sportonica or its servers will be free from viruses, malware, or other harmful components.
            </p>
            <p>To the fullest extent permitted by law, we&apos;re not liable for direct, indirect, incidental, special, punitive, consequential, or other damages arising from:</p>
            <ul>
              <li>your use of, or inability to use, the Services, website, or app;</li>
              <li>unauthorized access to or alteration of your transmissions or data; or</li>
              <li>any other matter relating to the Services, including loss of use, data, profits, or other intangible losses, whether in contract, tort (including negligence), strict liability, or otherwise.</li>
            </ul>
            <p>We&apos;re further not liable for delay in, or inability to use, Sportonica or its Services; any failure or deficiency in providing them; any information, software, products, or related graphics obtained through them; or claims arising from their use or performance. We may modify the contents of the website/app at any time without obligation to update information, and it&apos;s your responsibility to monitor changes.</p>
          </Section>

          <Section title="13. Assignment">
            <p>
              We may, at our sole discretion and at any time, assign, transfer, or subcontract our rights and
              obligations under these Terms to any person or entity, without prior notice. You may not
              assign, transfer, or subcontract your rights or obligations under these Terms without our prior
              written consent.
            </p>
          </Section>

          <Section title="14. Governing law and dispute settlement">
            <p>
              These Terms are governed by and construed under the laws of Nepal. In the event of a dispute,
              controversy, or claim arising from these Terms, the parties will seek to resolve it through
              negotiation, mediation, arbitration, or litigation. You irrevocably submit to the exclusive
              jurisdiction of the Courts of Nepal should the dispute be settled through litigation, and waive
              any objection to proceedings being brought there or any right to initiate proceedings
              elsewhere. Notwithstanding this, we reserve the right to initiate legal proceedings in any
              jurisdiction where you reside, conduct business, or hold assets in connection with a matter
              arising under this agreement.
            </p>
            <p>
              Disputes and questions about these Terms or our other policies can be sent by email to{" "}
              <a href="mailto:info@sportonica.com" style={{ color: "var(--sodium)", textDecoration: "underline", textUnderlineOffset: 2 }}>info@sportonica.com</a>.
            </p>
          </Section>

          <Section title="15. Miscellaneous">
            <p>
              Our rights and remedies under these Terms are cumulative, independent, and in addition to,
              and not in substitution for, any rights or remedies available under applicable law. No waiver of
              any breach constitutes a waiver of any preceding or subsequent breach, and any delay, failure,
              or omission in enforcing a provision, or any forbearance granted in respect of your
              obligations, isn&apos;t construed as a waiver of our rights. Nothing in these Terms confers any
              rights, benefits, or remedies on a third party. If any provision is held invalid, illegal, or
              unenforceable, it&apos;s severed to that extent and the remaining provisions stay in full force
              and effect. These Terms, as amended from time to time, constitute the entire agreement between
              you and us regarding the Services, and supersede all prior or contemporaneous agreements or
              understandings, written or oral.
            </p>
          </Section>

          <p className="hint legal-foot" style={{ marginTop: 28 }}>
            <Link href="/privacy">Privacy Policy</Link> ·{" "}
            <Link href="/account-deletion">Account Deletion</Link> ·{" "}
            <Link href="/">← Back to Sportonica</Link>
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
