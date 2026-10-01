import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { LegalMarkdown } from './LegalMarkdown';
import privacyMd from './legal/privacy.md?raw';
import termsMd from './legal/terms.md?raw';

const html = (md: string) => renderToStaticMarkup(<MemoryRouter><LegalMarkdown source={md} /></MemoryRouter>);

describe('LegalMarkdown', () => {
  it('placeholders become REPLACE BEFORE LAUNCH markers, including nested ones', () => {
    const out = html('Contact [PRIVACY EMAIL].\n\n[IF DPO: "Reach them at [EMAIL]."]');
    expect(out).toContain('[REPLACE BEFORE LAUNCH: PRIVACY EMAIL]');
    expect(out).toContain('IF DPO: &quot;Reach them at [EMAIL].&quot;');
    expect((out.match(/data-replace-before-launch/g) ?? []).length).toBe(2);
  });

  it('our page names link inside the app; [text](url) links out; tables, lists under a paragraph, line breaks', () => {
    const out = html(
      'See our [Pricing page] and [Privacy Policy]; [Stripe](https://stripe.com/legal).\n\nYou are responsible for:\n   - accuracy;\n   - **rights**.\n\n| A | B |\n|---|---|\n| x | y |\n\n**Effective:** [DATE]\n**Updated:** [DATE]',
    );
    expect(out).toContain('href="/pricing"');
    expect(out).toContain('href="/privacy"');
    expect(out).toContain('href="https://stripe.com/legal" target="_blank" rel="noopener noreferrer"');
    expect(out).toMatch(/<p>You are responsible for:<\/p><ul[^>]*><li>accuracy;<\/li><li><strong>rights<\/strong>.<\/li><\/ul>/);
    expect(out).toContain('<th>A</th><th>B</th>');
    expect(out).toContain('<td>x</td><td>y</td>');
    expect(out).toMatch(/<strong>Effective:<\/strong>.*<br\/><strong>Updated:<\/strong>/);
  });

  it('renders the real documents: every heading, no raw markdown left', () => {
    for (const [md, title, sections] of [
      [termsMd, 'Terms of Service', ['1. What TrueRCA Is', '9A. Copyright / IP Complaints (Notice-and-Takedown)', '16A. Severability, Entire Agreement, No Waiver', '17. Grievance Officer / Contact']],
      [privacyMd, 'Privacy Policy', ['1. Who We Are', '2.1 Information you give us', '5. Who We Share Data With', '13. Contact Us']],
    ] as const) {
      const out = html(md);
      expect(out).toContain(`<h1 class="text-3xl">${title}</h1>`);
      for (const s of sections) expect(out).toContain(s.replace(/&/g, '&amp;'));
      expect(out).not.toMatch(/\*\*|\]\(|^#/m);
    }
  });
});
