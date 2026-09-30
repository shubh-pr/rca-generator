import type { JumpTarget } from '../lib/fieldJump';

export interface Problem {
  text: string;
  /** Where the problem is; null shows plain text. */
  target: JumpTarget | null;
}

/**
 * Validation summary whose items jump to the field they are about (lib/fieldJump.ts). Used for
 * "Cannot submit for review", "Cannot close" and "Section is not complete".
 */
export function ProblemList({ title, problems, onJump, testId }: { title: string; problems: Problem[]; onJump: (t: JumpTarget) => void; testId?: string }) {
  return (
    <div className="w-full basis-full rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert" data-testid={testId}>
      <strong>{title}:</strong>
      <ul className="ml-5 list-disc">
        {problems.map((p) => (
          <li key={p.text}>
            {p.target ? (
              <button
                type="button"
                className="text-left underline decoration-red-400 underline-offset-2 hover:text-red-950 hover:decoration-red-800"
                onClick={() => onJump(p.target!)}
              >
                {p.text}
              </button>
            ) : (
              p.text
            )}
          </li>
        ))}
      </ul>
      {problems.some((p) => p.target) && <p className="mt-1 text-xs text-red-700">Select an item to go to it.</p>}
    </div>
  );
}
