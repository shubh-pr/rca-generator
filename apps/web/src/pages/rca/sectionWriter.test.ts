import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client';
import { resetSectionWriters, sectionWriter } from './sectionWriter';

const conflict = (current: number) => new ApiError(409, 'VERSION_CONFLICT', 'conflict', {}, { current_version: current });
afterEach(() => resetSectionWriters());

describe('sectionWriter', () => {
  it('runs writes of one section one at a time, each with the version the previous one returned', async () => {
    let server = 1;
    const sent: number[] = [];
    const write = async (version: number) => {
      sent.push(version);
      await new Promise((r) => setTimeout(r, 10));
      if (version !== server) throw conflict(server);
      return { version: ++server };
    };
    const w = sectionWriter('rca-1', 'DEV', 1);
    // Three writes started together (auto-save, Save draft, Submit) from the same stale version 1.
    const results = await Promise.all([w.run(write), sectionWriter('rca-1', 'DEV', 1).run(write), sectionWriter('rca-1', 'DEV', 1).run(write)]);
    expect(sent).toEqual([1, 2, 3]);
    expect(results.map((r) => r.version)).toEqual([2, 3, 4]);
  });

  it('a 409 naming a version this tab produced is retried once; a change from elsewhere is reported', async () => {
    const w = sectionWriter('rca-2', 'QA', 1);
    await w.run(async () => ({ version: 2 })); // our own write → v2
    const stale = sectionWriter('rca-2', 'QA', 1);
    let calls = 0;
    const ok = await stale.run(async (version) => {
      calls += 1;
      if (calls === 1 && version !== 2) throw conflict(2);
      return { version: version + 1 };
    });
    expect(ok.version).toBe(3);
    // Someone else moved it to v7: not ours, so it is a real conflict.
    await expect(sectionWriter('rca-2', 'QA', 3).run(async () => Promise.reject(conflict(7)))).rejects.toThrow('conflict');
  });

  it('follows the server when it is ahead (unlock by an editor, reload after a conflict)', () => {
    sectionWriter('rca-3', 'PROD', 4);
    expect(sectionWriter('rca-3', 'PROD', 9).version()).toBe(9);
  });
});
