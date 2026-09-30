import { ApiError } from '../../api/client';

/**
 * All writes to one team section from this browser tab (Save draft, auto-save, Submit, Unlock) go
 * through one queue per RCA section: they run one at a time, and each sends the newest version this
 * tab knows, including the one the previous write returned. Two writes from the same tab can therefore
 * never race each other into a 409. The state lives outside the component, so switching tabs while a
 * save is in flight does not lose it either.
 *
 * A 409 whose current version is one this tab produced itself is retried once with that version; any
 * other 409 is a real change from elsewhere (another tab or person) and is reported.
 */
interface WriterState {
  queue: Promise<unknown>;
  version: number;
  own: Set<number>;
}
const writers = new Map<string, WriterState>();

function state(key: string, serverVersion: number): WriterState {
  let w = writers.get(key);
  if (!w) {
    w = { queue: Promise.resolve(), version: serverVersion, own: new Set() };
    writers.set(key, w);
  }
  // The server may be ahead of us (unlock by an editor, reload after a real conflict): follow it.
  if (serverVersion > w.version) w.version = serverVersion;
  return w;
}

export function sectionWriter(rcaId: string, team: string, serverVersion: number) {
  const key = `${rcaId}:${team}`;
  const w = state(key, serverVersion);

  /** Run `write(version)` after every earlier write of this section; it returns the section's new version. */
  function run<T extends { version: number }>(write: (version: number) => Promise<T>): Promise<T> {
    const attempt = async (retried = false): Promise<T> => {
      try {
        const result = await write(w.version);
        w.version = result.version;
        w.own.add(result.version);
        return result;
      } catch (e) {
        const current = e instanceof ApiError && e.code === 'VERSION_CONFLICT' ? Number(e.details.current_version) : NaN;
        if (!retried && w.own.has(current)) {
          w.version = current; // our own earlier write; not a conflict
          return attempt(true);
        }
        throw e;
      }
    };
    const next = w.queue.then(() => attempt(), () => attempt());
    w.queue = next.catch(() => undefined);
    return next;
  }

  return { run, version: () => w.version };
}

/** Tests only. */
export function resetSectionWriters() {
  writers.clear();
}
