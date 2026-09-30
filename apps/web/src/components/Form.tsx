import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../api/client';

interface FieldProps {
  label: string;
  error?: string;
  children: ReactNode;
  hint?: string;
  className?: string;
  htmlFor?: string;
  /** Checked by "Submit for review" (red asterisk; see the legend on the RCA form). */
  required?: boolean;
}

/** Label (light blue, as in the template) + control + error text. */
export function Field({ label, error, children, hint, className = '', htmlFor, required }: FieldProps) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>
        <span className="inline-block rounded bg-label px-1.5 py-0.5">{label}</span>
        {required && <RequiredMark />}
      </label>
      {children}
      {hint && !error && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      {error && (
        <p className="mt-0.5 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className ?? ''}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={`input ${props.className ?? ''}`} />;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
  placeholder?: string;
}

export function Select({ options, placeholder = 'Select…', ...props }: SelectProps) {
  return (
    <select {...props} className={`input ${props.className ?? ''}`}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

const BILLING_CODES = ['BUCKET_FULL', 'SUBSCRIPTION_REQUIRED', 'SEAT_LIMIT_REACHED'];

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  if (error instanceof ApiError && BILLING_CODES.includes(error.code)) return <BillingBlock code={error.code} message={error.message} />;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
      {message}
    </div>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-label={title}>
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between rounded-t-lg bg-navy px-4 py-2 text-white">
          <h3 className="text-white">{title}</h3>
          <button type="button" onClick={onClose} className="text-white/80 hover:text-white" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
      <span>
        {total} record{total === 1 ? '' : 's'}
      </span>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ‹ Prev
        </button>
        <span>
          Page {page} of {pages}
        </span>
        <button type="button" className="btn-ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next ›
        </button>
      </div>
    </div>
  );
}

/** Explains BUCKET_FULL / SUBSCRIPTION_REQUIRED / SEAT_LIMIT_REACHED with the way out. */
export function BillingBlock({ code, message }: { code: string; message: string }) {
  const cta =
    code === 'BUCKET_FULL'
      ? 'Unlock or delete an RCA, or subscribe for unlimited RCAs.'
      : code === 'SEAT_LIMIT_REACHED'
        ? 'Add seats in Billing.'
        : 'Subscribe to the Team plan to invite people.';
  return (
    <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert" data-testid={`blocked-${code}`}>
      {message} {cta}{' '}
      <Link to="/settings/billing" className="font-semibold underline">
        Billing
      </Link>{' '}
      ·{' '}
      <Link to="/pricing" className="underline">
        Pricing
      </Link>
    </div>
  );
}

/** Red asterisk for fields that "Submit for review" requires; screen readers hear "required before review". */
export function RequiredMark() {
  return (
    <>
      <span className="ml-1 font-semibold text-red-600" aria-hidden="true" data-testid="required-mark">
        *
      </span>
      <span className="sr-only"> (required before review)</span>
    </>
  );
}

