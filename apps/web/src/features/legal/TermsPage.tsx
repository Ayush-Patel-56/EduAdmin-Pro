import { Link } from 'react-router-dom'
import { CONTACT_EMAIL } from './constants'
import { LegalLayout, List, Section } from './LegalLayout'

const mail = <a className="font-semibold underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
const privacy = <Link to="/privacy" className="font-semibold underline">Privacy Policy</Link>

/** Terms of Service for schools and their staff using EduAdmin Pro (Indian law). */
export function TermsPage() {
  return (
    <LegalLayout
      title="Terms of Service"
      description="The terms for schools, administrators and teachers using EduAdmin Pro, including responsibilities for student data, acceptable use and liability."
      path="/terms"
    >
      <p className="mt-6 text-[15px] leading-relaxed">
        These terms are an agreement between EduAdmin Pro (&quot;we&quot;, &quot;us&quot;) and the school or institute that uses it
        (&quot;the school&quot;), and every person who signs in on the school&apos;s behalf (&quot;you&quot;). By creating an account or
        using EduAdmin Pro you accept these terms and the {privacy}. If you don&apos;t accept them, please don&apos;t use the service.
      </p>

      <Section title="1. The service">
        <p>
          EduAdmin Pro is web software for running a school&apos;s academic work: programs and batches, timetables, attendance, tests and
          question banks, report cards, fees, staff, recruitment, feedback and parent-teacher meetings. We may improve, change or remove
          features over time; we will give reasonable notice before removing something a school relies on.
        </p>
      </Section>

      <Section title="2. Accounts">
        <List
          items={[
            'Give accurate details, verify your email address, and keep your password secret. You are responsible for what is done with your account.',
            `Tell us at once at ${CONTACT_EMAIL} if you think someone else has used your account.`,
            'An admin account is for a person who runs or administers a school. A teacher account is for staff of a school, who join it with the school’s teacher code.',
            'You must be at least 18 years old to hold an account. Students do not have accounts; they only use feedback links their school gives them.',
          ]}
        />
      </Section>

      <Section title="3. The school's responsibilities">
        <p>The school controls the personal data it puts into EduAdmin Pro and is responsible for it. In particular, the school must:</p>
        <List
          items={[
            "have a lawful basis for every record it adds about students, parents, staff and candidates, including any verifiable consent from parents or guardians that the Digital Personal Data Protection Act, 2023 requires for children's data;",
            'record only what it needs, keep it accurate, and answer requests from the people it is about (we will help);',
            'decide who gets access: share invite codes only with the right people, regenerate them if they leak, and remove people who should no longer have access (Members, on the school’s card);',
            'share each student feedback link only with that batch’s students, and switch it off or replace it if it is shared further;',
            'use the service in line with the law, including laws on education, children and data protection.',
          ]}
        />
        <p>We process the school&apos;s records only on its instructions and to provide the service, as described in the {privacy}.</p>
      </Section>

      <Section title="4. Acceptable use">
        <p>You must not:</p>
        <List
          items={[
            'upload anything unlawful, harmful, defamatory or that infringes someone else’s rights;',
            'try to get into accounts or data you aren’t allowed to see, probe or test the service’s security without our written permission, or get around its limits;',
            'overload the service, or use bots, scrapers or automated scripts against it;',
            'copy, resell or reverse engineer the service, or use it to build a competing product;',
            'use student feedback links to impersonate students, harass teachers or send false feedback.',
          ]}
        />
        <p>
          If you find a security problem, please tell us privately at {mail} and give us reasonable time to fix it before telling anyone
          else.
        </p>
      </Section>

      <Section title="5. Your data">
        <p>
          The school owns the records it puts into EduAdmin Pro. It gives us permission to store and process them only as needed to run
          the service for it. Admins can export much of the data from the app (for example to Excel or PDF) and can delete records, clear
          all of the school&apos;s data, or delete the school.
        </p>
      </Section>

      <Section title="6. Fees">
        <p>
          EduAdmin Pro is currently offered without charge. If we introduce paid plans, we will tell school admins the prices and terms in
          advance, and nothing will be charged without the school agreeing to it.
        </p>
      </Section>

      <Section title="7. Suspension and ending">
        <p>
          A school may stop using EduAdmin Pro at any time and delete its data. We may suspend or remove access, after notice where
          practical, if these terms are seriously or repeatedly broken, if required by law, or to protect the service, its users or
          students. If we ever stop offering the service, we will give schools reasonable notice to export their data first.
        </p>
      </Section>

      <Section title="8. Availability and disclaimers">
        <p>
          We work to keep EduAdmin Pro available, accurate and secure, but it is provided &quot;as is&quot; and &quot;as available&quot;.
          We do not promise it will be uninterrupted or error-free. Schools remain responsible for the decisions they make using it,
          such as marks, fees and report cards, and should check important figures.
        </p>
      </Section>

      <Section title="9. Limitation of liability">
        <p>
          To the extent the law allows, we are not liable for indirect or consequential losses (such as lost profits or lost data that
          could have been exported), and our total liability for any claim about the service is limited to the amount the school paid us
          for it in the 12 months before the claim. Nothing in these terms limits liability that cannot be limited under Indian law.
        </p>
      </Section>

      <Section title="10. Indemnity">
        <p>
          The school will compensate us for claims by others that arise from records it uploaded without a lawful basis, or from its
          users breaking these terms.
        </p>
      </Section>

      <Section title="11. Changes to these terms">
        <p>
          We may update these terms. We will change the date at the top and tell school admins in the app or by email before a
          significant change takes effect. Continuing to use EduAdmin Pro after that means you accept the updated terms.
        </p>
      </Section>

      <Section title="12. Law and disputes">
        <p>
          These terms are governed by the laws of India. Please contact us first so we can try to resolve any dispute informally; if we
          can&apos;t, the courts of India have jurisdiction.
        </p>
      </Section>

      <Section title="13. Contact">
        <p>Questions about these terms: {mail}.</p>
      </Section>
    </LegalLayout>
  )
}
