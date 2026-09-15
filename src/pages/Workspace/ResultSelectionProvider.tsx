import { type ReactNode } from 'react';
import { ResultSelectionContext, useRowSelection } from './resultSelection';

interface ResultSelectionProviderProps {
  /** Reset key — pass the same `documents` reference the views render
   *  against so a new query run / page change / tab switch / post-delete
   *  re-run clears the selection (spec AC6). Must be a stable reference
   *  across renders that shouldn't reset selection (e.g. a module-level
   *  empty-array constant when there's no result yet), not a fresh `?? []`
   *  literal. */
  documents: unknown[];
  children: ReactNode;
}

/**
 * Scopes bulk-selection state (T0.4) to a `<ResultViewer>` subtree. Kept as
 * its own component file (rather than folded into `resultSelection.ts`) so
 * that module stays hook/context-only and satisfies the
 * `react-refresh/only-export-components` lint rule.
 */
export function ResultSelectionProvider({ documents, children }: ResultSelectionProviderProps) {
  const value = useRowSelection(documents);
  return (
    <ResultSelectionContext.Provider value={value}>{children}</ResultSelectionContext.Provider>
  );
}
