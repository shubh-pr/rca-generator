import type { ReactNode } from 'react';
import { PublicLayout, Replace } from './PublicLayout';

function Doc({ title, updated, children }: { title: string; updated: ReactNode; children: ReactNode }) {
  return (
    <PublicLayout>
      <article className="prose mx-auto max-w-3xl space-y-4 px-4 py-10 [&_h2]:mt-6 [&_li]:ml-5 [&_li]:list-disc">
        <h1 className="text-3xl">{title}</h1>
        <p className="text-sm text-slate-500">Last updated: {updated}</p>
        {children}
      </article>
    </PublicLayout>
  );
}

/** Terms of Service template. Every <Replace> must be filled in before launch. */
export function TermsPage() {
  return (
    <Doc title="Terms of Service" updated={<Replace>date</Replace>}>
      <p>
        These terms govern your use of RCA Dashboard (the "Service"), operated by <Replace>legal entity name, registered address and
        company number</Replace> ("we", "us").
      </p>
      <h2>1. Your account</h2>
      <p>You must give a valid email address and keep your password secret. You are responsible for activity in your account.</p>
      <h2>2. Your content</h2>
      <p>
        You own the RCAs, files and other content you add. You grant us only the rights needed to host, process and show it to you and the
        people you share it with. You must have the right to upload what you add and must not upload unlawful content or personal data you
        are not allowed to process.
      </p>
      <h2>3. Acceptable use</h2>
      <ul>
        <li>No attempts to access other users' data or to disrupt the Service.</li>
        <li>No malware, spam or illegal content.</li>
        <li>No automated scraping or excessive load.</li>
      </ul>
      <h2>4. Availability and changes</h2>
      <p>
        The Service is provided "as is". We may change or discontinue features and will give reasonable notice of material changes to these
        terms. <Replace>service level or support commitments, if any</Replace>
      </p>
      <h2>5. Termination</h2>
      <p>You can delete your account at any time in Account settings. We may suspend accounts that break these terms.</p>
      <h2>6. Liability</h2>
      <p>
        <Replace>limitation of liability and warranty disclaimer wording reviewed by a lawyer for your jurisdiction</Replace>
      </p>
      <h2>7. Governing law</h2>
      <p>
        <Replace>governing law and courts, for example the laws of India and the courts of Bengaluru</Replace>
      </p>
      <h2>8. Contact</h2>
      <p>
        <Replace>contact email for legal questions</Replace>
      </p>
    </Doc>
  );
}

/** Privacy Policy template written for GDPR and India's DPDP Act 2023. Fill every <Replace>. */
export function PrivacyPage() {
  return (
    <Doc title="Privacy Policy" updated={<Replace>date</Replace>}>
      <p>
        This policy explains how <Replace>legal entity name and address</Replace> (the data controller / data fiduciary) processes personal
        data in RCA Dashboard.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li>Account data: name, email address, password hash (never the password), email-verification status.</li>
        <li>Content you add: RCAs, comments, names you type into RCA fields, and uploaded files.</li>
        <li>Security data: login sessions (browser user agent), security events such as logins and password changes.</li>
      </ul>
      <p>We do not use advertising or analytics cookies. The only cookies are essential sign-in cookies (session refresh and CSRF protection).</p>
      <h2>Why we use it (legal bases)</h2>
      <ul>
        <li>To provide the Service you signed up for (contract / GDPR Art. 6(1)(b); DPDP consent and legitimate use).</li>
        <li>To keep the Service secure and prevent abuse (legitimate interests / GDPR Art. 6(1)(f)).</li>
        <li>To send essential emails: verification, password reset, invitations and account notices.</li>
      </ul>
      <h2>Who can see your data</h2>
      <p>
        Only you and the people you invite to a workspace or an RCA. Our staff cannot see RCA content except through an audited, time-limited
        support access used for support or abuse cases. Processors: <Replace>hosting provider, email provider, object-storage provider and
        their locations</Replace>.
      </p>
      <h2>International transfers</h2>
      <p>
        <Replace>where data is stored and the safeguards for transfers outside the EU/EEA or India</Replace>
      </p>
      <h2>How long we keep it</h2>
      <ul>
        <li>While your account is active.</li>
        <li>When you delete your account, you can no longer log in immediately, and your personal data and files are permanently deleted after the grace period (<Replace>number of days, default 14</Replace>).</li>
        <li>Backups are overwritten within <Replace>backup retention period</Replace>.</li>
      </ul>
      <h2>Your rights</h2>
      <p>
        You can access, correct, export (Account settings → Export my data) and delete (Account settings → Delete account) your data at any
        time, withdraw consent, and object to processing. You can also complain to your data-protection authority, or in India to the Data
        Protection Board. Grievance officer / contact: <Replace>name and email of the grievance officer or DPO</Replace>.
      </p>
      <h2>Security</h2>
      <p>Passwords are hashed with argon2id, all traffic uses HTTPS, and access to data is checked on every request.</p>
      <h2>Changes</h2>
      <p>We will notify you by email of material changes to this policy.</p>
    </Doc>
  );
}

export function ContactPage() {
  return (
    <Doc title="Contact" updated={<Replace>date</Replace>}>
      <p>
        Questions, support or privacy requests: <Replace>support email address</Replace>
      </p>
      <p>
        Postal address: <Replace>postal address</Replace>
      </p>
      <p>
        Report a security issue: <Replace>security contact email</Replace>
      </p>
    </Doc>
  );
}
