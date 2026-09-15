import type { ProbeErrorCode } from '@shared/types';

/**
 * Identifier for a one-click recovery action a recipe step suggests. The
 * drawer renders a button for each step that declares one *and* whose id
 * has a matching handler in the `actions` map passed to `open()`.
 */
export type SuggestedActionId = 'retryWithoutTls' | 'retryDirectConnection';

/**
 * Optional handlers a trigger site (e.g. the NewConnection page) can pass
 * to `useTroubleshooting().open()`. The handler resolves with `true` when
 * the action succeeded — the drawer closes itself in that case. `false` /
 * thrown errors leave the drawer open so the user can read the next step.
 */
export type RecipeActionHandlers = Partial<
  Record<SuggestedActionId, () => Promise<boolean>>
>;

export interface RecipeStep {
  /** One-line action verb. */
  title: string;
  /**
   * Single-paragraph body. Renders as inline markdown supporting:
   *  - **bold**
   *  - *italic*
   *  - `code`
   *  - [link](https://...)
   */
  body: string;
  /**
   * Optional one-click recovery hint. The drawer renders a button labelled
   * by `ACTION_LABEL[suggestedAction]` *only* when the trigger site
   * supplied a matching handler.
   */
  suggestedAction?: SuggestedActionId;
}

export interface Recipe {
  /** Stable id. Matches the `## <id>` heading in docs/troubleshooting.md. */
  id: string;
  /** Returns true if this recipe should fire for the given failure. */
  match: (input: RecipeMatchInput) => boolean;
  /** Drawer heading. */
  title: string;
  /** Single paragraph the user reads first. */
  diagnosis: string;
  steps: RecipeStep[];
  /** Anchor in docs/troubleshooting.md. Same as `id` for v1. */
  docAnchor: string;
}

export interface RecipeMatchInput {
  errorCode?: ProbeErrorCode;
  message?: string;
}
