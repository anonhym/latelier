import React from 'react';
import { SuggestionPopover } from './SuggestionPopover';
import { useSuggestions } from './useSuggestions';
import type { Suggestion, SuggestionContext } from './types';
import { getCaretRect } from './caretPosition';
import { detectAggGrammar, type GrammarHit } from './aggGrammar';
import { DEFAULT_FIELD_SOURCES, operatorSource } from './sources';

// Textareas edit JSON-like bodies where both field names and `$operator` keys
// are valid at a key position — include both source kinds.
const KEY_POSITION_SOURCES = [...DEFAULT_FIELD_SOURCES, operatorSource];

interface Options {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  suggestionContext: SuggestionContext | null;
  /** Called with the new textarea body when the user accepts a suggestion. */
  onReplace: (nextValue: string) => void;
  /**
   * Aggregation stage op enclosing this textarea (e.g. `$match`, `$group`).
   * The grammar detector uses it to tag the caret with an `operatorContext`,
   * which ranks context-appropriate operators first.
   */
  stageOp?: string;
}

/**
 * Glue hook for textarea autocomplete: tracks caret-driven grammar state,
 * positions a zero-size anchor, and renders the shared popover. Consumers
 * call `probe()` from any event that moves the caret and spread `onBlur`
 * onto the textarea to dismiss the popover on focus loss.
 */
export function useTextareaAutocomplete({ textareaRef, suggestionContext, onReplace, stageOp }: Options) {
  const anchorRef = React.useRef<HTMLSpanElement>(null);
  const [grammar, setGrammar] = React.useState<GrammarHit | null>(null);
  const [anchorPos, setAnchorPos] = React.useState<{ top: number; left: number; height: number } | null>(null);

  const popoverContext = React.useMemo<SuggestionContext | null>(() => {
    if (!grammar || !suggestionContext) return null;
    if (grammar.kind !== 'fieldName' && grammar.kind !== 'fieldRef') return null;
    const opCtx = grammar.kind === 'fieldName' ? grammar.operatorContext : undefined;
    return opCtx ? { ...suggestionContext, operatorContext: opCtx } : suggestionContext;
  }, [grammar, suggestionContext]);

  const { items } = useSuggestions(popoverContext, grammar?.token ?? '', {
    fieldSources: KEY_POSITION_SOURCES,
  });
  const open = !!popoverContext && items.length > 0;

  const probe = React.useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const caret = ta.selectionStart ?? 0;
    const hit = detectAggGrammar(ta.value, caret, stageOp);
    setGrammar(hit);
    setAnchorPos(hit ? getCaretRect(ta, caret) : null);
  }, [textareaRef, stageOp]);

  const onBlur = React.useCallback(() => {
    window.setTimeout(() => setGrammar(null), 120);
  }, []);

  const close = React.useCallback(() => setGrammar(null), []);

  const onSelect = React.useCallback(
    (s: Suggestion) => {
      const ta = textareaRef.current;
      if (!ta || !grammar) return;
      let insert: string;
      if (s.kind === 'field') insert = s.path;
      else if (s.kind === 'operator') insert = s.name;
      else return;
      const before = ta.value.slice(0, grammar.replaceStart);
      const after = ta.value.slice(grammar.replaceEnd);
      const next = before + insert + after;
      const nextCaret = grammar.replaceStart + insert.length;
      setGrammar(null);
      setAnchorPos(null);
      onReplace(next);
      window.requestAnimationFrame(() => {
        const t = textareaRef.current;
        if (!t) return;
        t.focus();
        t.setSelectionRange(nextCaret, nextCaret);
      });
    },
    [grammar, textareaRef, onReplace],
  );

  const popover = (
    <>
      {anchorPos && (
        <span
          ref={anchorRef}
          aria-hidden="true"
          style={{
            position: 'fixed',
            top: anchorPos.top,
            left: anchorPos.left,
            width: 0,
            height: anchorPos.height,
            pointerEvents: 'none',
          }}
        />
      )}
      <SuggestionPopover
        open={open}
        items={items}
        anchorRef={anchorRef}
        keyboardRef={textareaRef}
        onSelect={onSelect}
        onClose={close}
      />
    </>
  );

  return { probe, onBlur, popover };
}
