import fs from 'node:fs';
import { MAIL_LOG } from '../playwright.config';

export default function globalSetup() {
  fs.rmSync(MAIL_LOG, { force: true });
}
