import { createContext, useContext } from 'react';
import type { JumpTarget } from '../../lib/fieldJump';

/** Provided by the RCA form (RcaEditPage): switch to a tab (with the unsaved-changes check) and jump to a field. */
export const RcaJumpContext = createContext<((t: JumpTarget) => void) | null>(null);
export const useRcaJump = () => useContext(RcaJumpContext);
