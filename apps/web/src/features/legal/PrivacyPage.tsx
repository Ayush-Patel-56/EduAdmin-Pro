import { Link } from 'react-router-dom'
import { CONTACT_EMAIL } from './constants'
import { LegalLayout, List, Section } from './LegalLayout'

const mail = <a className="font-semibold underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>

/** Privacy Policy: what EduAdmin Pro stores, why, where, for how long, and people's rights (India, DPDP Act 2023). */
export function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      description="How EduAdmin Pro collects, uses, stores and protects the personal data of schools, staff, students and parents, and how to exercise your rights."
      path="/privacy"
    >
      <p className="mt-6 text-[15px] leading-relaxed">
        EduAdmin Pro (&quot;EduAdmin Pro&quot;, &quot;we&quot;, &quot;us&quot;) is software that schools and coaching institutes use to run
        their academic work: timetables, attendance, tests, report cards, fees, staff and parent communication. This policy explains
        what personal data the service holds, why, where it is kept, for how long, and the rights people have over it. It is written
        for India&apos;s Digital Personal Data Protection Act, 2023 (the &quot;DPDP Act&quot;).
      </p>

      <Section title="1. Who is responsible for the data">
        <p>
          <strong>Your school decides what to record about its students, parents and staff, and why.</strong> Under the DPDP Act the
          school is the <em>Data Fiduciary</em> for those records. EduAdmin Pro processes them on the school&apos;s behalf and only to
          provide the service to that school (we act as its <em>Data Processor</em>).
        </p>
        <p>
          For the data needed to run accounts and keep the service secure (sign-in details, sessions and security logs), EduAdmin Pro
          decides how it is used and is responsible for it.
        </p>
        <p>
          If you are a student, parent or staff member and want to see, correct or delete your records, please contact your school
          first. We will help the school answer you.
        </p>
      </Section>

      <Section title="2. What we collect">
        <p><strong>Accounts (school admins and teachers)</strong></p>
        <List
          items={[
            'Name, email address and a password (stored only as a one-way hash; we can never read it).',
            'Optional details you add: department or subject, employee ID, profile picture, and preferences such as email notifications and theme.',
            'Sign-in sessions: when they started and expire, the browser or device description and the IP address they came from.',
            'Email verification codes (stored as a one-way hash) and records of which daily digest emails were sent.',
          ]}
        />
        <p><strong>Records a school enters or imports</strong></p>
        <List
          items={[
            <>
              <strong>Students:</strong> name, admission and roll number, class, program and batch, photo, date of birth, gender, blood
              group, contact details, address, Aadhaar number (if the school chooses to record it), previous school and score, notes,
              and parent or guardian names and contact details.
            </>,
            <>
              <strong>Academic and school records:</strong> attendance, test papers, answers and marks, report cards and progress
              reports, daily ratings, assignments and submissions, counseling sessions, parent-teacher meeting notes, fees due and
              paid, timetables, calendars and meeting notes.
            </>,
            <>
              <strong>Staff:</strong> name, contact details, employee ID, date of birth, gender, address, subjects, qualifications,
              experience, photo, daily reports and appraisals.
            </>,
            <>
              <strong>Recruitment:</strong> candidates&apos; names, contact details, qualifications, current employer, expected salary,
              résumé links and interview notes.
            </>,
            <>
              <strong>Feedback:</strong> feedback between management and teachers, and feedback students send about their teachers
              through their batch&apos;s feedback link (the student&apos;s name, the teacher, a rating and a comment).
            </>,
            'Files the school uploads, such as study material, assignment sheets, submissions and photos.',
          ]}
        />
        <p><strong>Technical data</strong></p>
        <List
          items={[
            'To stop abuse (for example password guessing) we count requests per IP address and per account. These counters store only a one-way hash of the IP address or email, and expire within minutes.',
            'Our hosting provider records standard request logs (such as IP address, time and page requested) to operate and secure the service.',
          ]}
        />
      </Section>

      <Section title="3. Why we use it">
        <List
          items={[
            'To provide the service to the school: show each person the records their role allows, and send the emails the service needs (verification codes and, if switched on, the daily digest).',
            'To keep accounts and data secure: verifying email addresses, limiting sign-in attempts, and detecting and investigating misuse.',
            'To fix problems and keep the service running.',
          ]}
        />
        <p>
          We do <strong>not</strong> sell personal data, show advertising, or use school records to build profiles, train AI models or
          market to students or parents.
        </p>
      </Section>

      <Section title="4. Children's data">
        <p>
          Most student records are about children. The school, as Data Fiduciary, is responsible for having a lawful basis for
          recording them, including any verifiable consent from parents or guardians that the DPDP Act requires. Inside EduAdmin Pro,
          students&apos; records are visible only to that school&apos;s admins and, in part, to its teachers. Teachers see students
          according to the classes the school assigns them, without contact details. We never track children&apos;s behaviour for
          advertising.
        </p>
        <p>
          A school may share a feedback link with a batch&apos;s students. Anyone who has that link sees the batch&apos;s student names
          (so a student can pick their own) and the batch&apos;s teachers, and can send feedback. The school can switch a link off or
          replace it at any time. Teachers see the feedback about them without the student&apos;s name.
        </p>
      </Section>

      <Section title="5. Who can see it">
        <List
          items={[
            "Within a school: its admins see the school's records; teachers see only what their role and assignments allow. One school can never see another school's data.",
            'Service providers who host and run EduAdmin Pro for us, under contracts that require them to protect the data and use it only to provide their service. They are listed below.',
            'Authorities, if Indian law requires us to disclose data. We will tell the affected school unless the law forbids it.',
          ]}
        />
        <p><strong>Service providers</strong></p>
        <List
          items={[
            'Vercel: hosts the website and the application (the application runs in Singapore).',
            'Neon: hosts the database (Singapore).',
            'Cloudflare R2: stores uploaded files in a private bucket; files open only through short-lived signed links.',
            'Google (Gmail): sends the service’s emails.',
          ]}
        />
        <p>
          This means data is stored and processed outside India, mainly in Singapore. The DPDP Act allows this, except to countries the
          Government of India restricts; we will move data if that ever applies.
        </p>
      </Section>

      <Section title="6. How long we keep it">
        <List
          items={[
            "School records stay for as long as the school uses EduAdmin Pro. The school's admins can delete individual records, and its owner can clear all of the school's data or delete the school; deleted data is removed from the live database at once.",
            'Sign-in sessions end after 30 days and are deleted daily once ended. Verification codes are deleted a day after they expire. Read notifications are deleted after 60 days, and records of sent digest emails after 30 days.',
            'Copies may remain in our providers’ backups for a limited period before they are overwritten.',
          ]}
        />
      </Section>

      <Section title="7. How we protect it">
        <List
          items={[
            'All traffic is encrypted (HTTPS). Passwords are hashed with Argon2; sign-in tokens and verification codes are stored only as hashes.',
            "Every request is checked against the person's school and role, and each school's records are kept apart in the database.",
            'Sign-in and verification attempts are limited, and requests from other websites that try to act on your behalf are refused.',
            'Uploaded files are private and opened only through signed links that expire.',
          ]}
        />
        <p>
          No system is perfectly secure. If a personal data breach happens, we will inform the affected schools without undue delay so
          that they and we can notify the Data Protection Board of India and the people affected, as the DPDP Act requires.
        </p>
      </Section>

      <Section title="8. Cookies and browser storage">
        <p>
          We use one essential cookie, which keeps you signed in. It can&apos;t be read by scripts on the page and is sent only to
          EduAdmin Pro. Your browser also remembers a few choices on your device, such as the program and batch you last selected. We use
          no advertising or analytics cookies and no third-party trackers.
        </p>
      </Section>

      <Section title="9. Your rights">
        <p>Under the DPDP Act you can ask:</p>
        <List
          items={[
            'for a summary of the personal data held about you and how it is used;',
            'for it to be corrected, completed or updated;',
            'for it to be erased when it is no longer needed (subject to records the school must keep by law);',
            'to nominate someone to exercise these rights if you die or become unable to;',
            'and to have a grievance about how your data is handled addressed.',
          ]}
        />
        <p>
          For records your school keeps, contact the school; we will support its reply. For your own account, email {mail}. We aim to
          reply within 30 days. If you are not satisfied with the answer, you may complain to the Data Protection Board of India.
        </p>
      </Section>

      <Section title="10. Grievances and contact">
        <p>
          Questions, requests and complaints about privacy: {mail}. Please include the school&apos;s name and the email address of your
          account, if you have one.
        </p>
      </Section>

      <Section title="11. Changes to this policy">
        <p>
          If we change this policy we will update the date at the top, and tell school admins in the app or by email before a
          significant change takes effect. See also our <Link to="/terms" className="font-semibold underline">Terms of Service</Link>.
        </p>
      </Section>
    </LegalLayout>
  )
}
