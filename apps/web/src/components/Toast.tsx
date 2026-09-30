import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

type Tone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  tone: Tone;
  message: string;
}
interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);
/** Success and info disappear after 3 s; errors stay 6 s (and can be closed) so they are not missed. */
const DURATION: Record<Tone, number> = { success: 3000, info: 3000, error: 6000 };
const STYLE: Record<Tone, string> = {
  success: 'border-green-300 bg-green-50 text-green-900',
  info: 'border-slate-300 bg-white text-slate-800',
  error: 'border-red-300 bg-red-50 text-red-800',
};
const ICON: Record<Tone, string> = { success: '✓', info: 'ℹ', error: '!' };

/** App-wide toasts (bottom right). Use `useToast()` for save confirmations and failures. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (tone: Tone, message: string) => {
      const id = next.current++;
      // The same message twice in a row replaces the first instead of stacking.
      setItems((list) => [...list.filter((t) => t.message !== message).slice(-3), { id, tone, message }]);
      window.setTimeout(() => dismiss(id), DURATION[tone]);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(() => ({ success: (m) => push('success', m), error: (m) => push('error', m), info: (m) => push('info', m) }), [push]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 print:hidden" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            data-testid="toast"
            data-tone={t.tone}
            className={`pointer-events-auto flex items-start gap-2 rounded border px-3 py-2 text-sm shadow-md ${STYLE[t.tone]}`}
          >
            <span aria-hidden="true" className="font-bold">
              {ICON[t.tone]}
            </span>
            <span className="flex-1">{t.message}</span>
            <button type="button" className="text-xs opacity-70 hover:opacity-100" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
