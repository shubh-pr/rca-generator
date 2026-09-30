import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Local form state with dirty tracking. When the server values of *these* fields change (after this
 * form saved, or someone else did), they are merged in field by field: a field the user has not
 * touched since the last sync takes the server value, a field edited locally keeps the edit. So text
 * typed while a save is in flight is never thrown away, and saving another part of the RCA keeps
 * unsaved edits. `discardOnNextSync()` makes the next sync replace everything (Reload after a conflict).
 */
export function useDirtyForm<T extends Record<string, unknown>>(initial: T) {
  const initialJson = JSON.stringify(initial);
  const [base, setBase] = useState(initial);
  const [values, setValues] = useState(initial);
  const baseRef = useRef(initial);
  const replaceNext = useRef(false);

  useEffect(() => {
    const next = JSON.parse(initialJson) as T;
    const prev = baseRef.current;
    baseRef.current = next;
    setBase(next);
    if (replaceNext.current) {
      replaceNext.current = false;
      setValues(next);
      return;
    }
    setValues((current) => {
      const merged = { ...next };
      for (const key of Object.keys(next) as (keyof T)[]) {
        if (!same(current[key], prev[key])) merged[key] = current[key]; // edited locally since the last sync
      }
      return merged;
    });
  }, [initialJson]);

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
  }, []);

  const dirty = useMemo(() => !same(values, base), [values, base]);
  const reset = useCallback(() => setValues(baseRef.current), []);
  const discardOnNextSync = useCallback(() => {
    replaceNext.current = true;
  }, []);

  return { values, set, setValues, dirty, reset, discardOnNextSync };
}
