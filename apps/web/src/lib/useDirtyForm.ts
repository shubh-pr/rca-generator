import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Local form state with dirty tracking. Resets only when the server values of *these* fields
 * change (e.g. after this form saved), so saving another part of the RCA keeps unsaved edits.
 */
export function useDirtyForm<T extends Record<string, unknown>>(initial: T) {
  const initialJson = JSON.stringify(initial);
  const [base, setBase] = useState(initial);
  const [values, setValues] = useState(initial);

  useEffect(() => {
    const next = JSON.parse(initialJson) as T;
    setBase(next);
    setValues(next);
  }, [initialJson]);

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
  }, []);

  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(base), [values, base]);
  const reset = useCallback(() => setValues(base), [base]);

  return { values, set, setValues, dirty, reset };
}
