import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { useToast } from './Toast';

const CONFIRM_MS = 2000;

/**
 * Save feedback for any save action: a toast on success or failure (never silent) and a short
 * "Saved" state for the button. `succeeded("Header saved")` / `failed(error, "Header")`.
 */
export function useSaveFeedback() {
  const toast = useToast();
  const [saved, setSaved] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const succeeded = useCallback(
    (message: string) => {
      toast.success(message);
      setSaved(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setSaved(false), CONFIRM_MS);
    },
    [toast],
  );
  const failed = useCallback(
    (error: unknown, what: string) => {
      setSaved(false);
      toast.error(saveErrorMessage(error, what));
    },
    [toast],
  );
  return { saved, succeeded, failed, info: toast.info };
}

/**
 * Save for a form with dirty tracking (RCA tabs): with no edits it only says so (no request, nothing
 * changes on the server); otherwise it runs the existing mutation and reports the result.
 */
export function useFormSave(mutation: { mutate: (v: undefined, o: { onSuccess: () => void; onError: (e: unknown) => void }) => void }, dirty: boolean, what: string, successMessage: string) {
  const fb = useSaveFeedback();
  const run = () => {
    if (!dirty) return fb.info('No changes to save');
    mutation.mutate(undefined, { onSuccess: () => fb.succeeded(successMessage), onError: (e) => fb.failed(e, what) });
  };
  return { run, saved: fb.saved };
}

/** "Header not saved: …" with a reason a user can act on. */
export function saveErrorMessage(error: unknown, what: string): string {
  const prefix = `${what} not saved`;
  if (error instanceof ApiError) {
    if (error.code === 'VERSION_CONFLICT') return `${prefix}: ${error.message}`;
    if (Object.keys(error.fields).length) return `${prefix}: check the highlighted fields.`;
    if (error.status === 401) return `${prefix}: your session ended. Log in again.`;
    return `${prefix}: ${error.message}`;
  }
  // fetch() rejects with a TypeError when the server cannot be reached.
  if (error instanceof TypeError) return `${prefix}: the server could not be reached. Check your connection and try again.`;
  return `${prefix}. Please try again.`;
}

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />;
}

/**
 * A save button with state: "Saving…" with a spinner (disabled, so no double submit), then
 * "✓ Saved" for 2 s, then its normal label again. The accessible name stays `label`; the toast
 * announces the result.
 */
export function SaveButton({
  label,
  pending,
  saved,
  onClick,
  disabled,
  className = 'btn-primary',
  id,
  type = 'button',
}: {
  label: string;
  pending: boolean;
  saved: boolean;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** "submit" inside a <form>; the form's onSubmit runs the save. */
  type?: 'button' | 'submit';
}) {
  const state = pending ? 'saving' : saved ? 'saved' : 'idle';
  return (
    <button type={type} id={id} className={className} disabled={disabled || pending} onClick={onClick} aria-label={label} data-state={state}>
      {state === 'saving' ? (
        <>
          <Spinner /> Saving…
        </>
      ) : state === 'saved' ? (
        <>
          <span aria-hidden="true">✓</span> Saved
        </>
      ) : (
        label
      )}
    </button>
  );
}

/** Amber dot + "Unsaved changes" while a form has edits that are not saved yet. */
export function UnsavedBadge({ dirty }: { dirty: boolean }) {
  if (!dirty) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700" data-testid="unsaved-indicator">
      <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
      Unsaved changes
    </span>
  );
}
