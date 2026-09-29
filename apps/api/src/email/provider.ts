import fs from 'node:fs';
import nodemailer from 'nodemailer';
import { config } from '../config.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Template name, for logs and tests. */
  template: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/**
 * Development provider: prints the message (including links) and appends it as JSON to MAIL_LOG_FILE.
 * Refused in production by config validation.
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  /** Recent messages, for tests. */
  readonly outbox: (EmailMessage & { sent_at: string })[] = [];

  async send(m: EmailMessage) {
    const entry = { ...m, sent_at: new Date().toISOString() };
    this.outbox.push(entry);
    if (this.outbox.length > 200) this.outbox.shift();
    if (config.email.logFile) fs.appendFileSync(config.email.logFile, `${JSON.stringify(entry)}\n`);
    if (config.env !== 'test') console.log(`[email:${m.template}] to=${m.to} subject="${m.subject}"\n${m.text}\n`);
  }
}

export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private transport = nodemailer.createTransport({
    host: config.email.smtp.host,
    port: config.email.smtp.port,
    secure: config.email.smtp.secure,
    auth: config.email.smtp.user ? { user: config.email.smtp.user, pass: config.email.smtp.pass } : undefined,
  });

  async send(m: EmailMessage) {
    await this.transport.sendMail({ from: config.email.from, to: m.to, subject: m.subject, text: m.text, html: m.html });
  }
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  async send(m: EmailMessage) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.email.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.email.from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend returned ${res.status}`);
  }
}

export function createEmailProvider(): EmailProvider {
  switch (config.email.provider) {
    case 'smtp':
      return new SmtpEmailProvider();
    case 'resend':
      return new ResendEmailProvider();
    default:
      return new ConsoleEmailProvider();
  }
}
