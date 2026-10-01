import type { ReactNode } from 'react';
import { LegalMarkdown } from './LegalMarkdown';
import privacyMd from './legal/privacy.md?raw';
import termsMd from './legal/terms.md?raw';
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

/** Terms of Service: the text lives in ./legal/terms.md. Every placeholder shows as REPLACE BEFORE LAUNCH. */
export function TermsPage() {
  return (
    <PublicLayout>
      <article className="mx-auto max-w-3xl space-y-4 px-4 py-10 [&_h2]:mt-8 [&_h3]:mt-4" data-testid="legal-terms">
        <LegalMarkdown source={termsMd} />
      </article>
    </PublicLayout>
  );
}

/** Privacy Policy: the text lives in ./legal/privacy.md. */
export function PrivacyPage() {
  return (
    <PublicLayout>
      <article className="mx-auto max-w-3xl space-y-4 px-4 py-10 [&_h2]:mt-8 [&_h3]:mt-4" data-testid="legal-privacy">
        <LegalMarkdown source={privacyMd} />
      </article>
    </PublicLayout>
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
