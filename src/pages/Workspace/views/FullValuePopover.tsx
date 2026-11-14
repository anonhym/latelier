import React from 'react';
import { ActionIcon, Button, Popover, VisuallyHidden } from '@mantine/core';
import { copyToClipboard } from '../../../utils/clipboard';

interface FullValuePopoverProps {
  /** The value's display text, untruncated. */
  display: string;
  /** Strings are shown quoted, so `"1"` and `1` stay distinguishable. */
  isString: boolean;
  /** The field's dotted path, shown in the header. */
  fieldPath?: string;
  /** The value's type name, shown in the header. */
  typeLabel?: string;
  /** Opens the Document Editor on this field. Omitted where there is no editor (a snapshot). */
  onOpenInEditor?: () => void;
  opened: boolean;
  onChange: (opened: boolean) => void;
  /** Hover/focus-revealed: the trigger is always mounted, but invisible and
   * click-through until the host says it should show. */
  visible: boolean;
  ariaLabel?: string;
  /** `-1` keeps the trigger out of Tab order where the host already opens
   * the popover from the keyboard (Enter on the active Tree leaf). */
  tabIndex?: number;
}

/**
 * The `⤢` affordance that opens a read-only popover with a value's full,
 * untruncated text. Shared by Table cells and Tree/expanded-row leaves. The
 * trigger is absolutely positioned at the right edge of its host, which must
 * be `position: relative`. Its own `stopPropagation` keeps a click from also
 * selecting, expanding or activating the row underneath.
 *
 * Focus moves into the dropdown however it was opened, so Escape closes it
 * (without reaching the row or panel behind) and Mantine's `returnFocus`
 * sends focus back to whatever held it before.
 */
export function FullValuePopover({
  display,
  isString,
  fieldPath,
  typeLabel,
  onOpenInEditor,
  opened,
  onChange,
  visible,
  ariaLabel = 'Expand cell value',
  tabIndex,
}: FullValuePopoverProps) {
  const labelId = React.useId();
  // A stable callback ref runs once per mount of the dropdown, which the
  // popover's transition renders a commit or more after `opened` flips.
  // Deferred a tick: Mantine's `returnFocus` records the focused element in an
  // effect after this commit, and focusing the dropdown first would make the
  // dropdown itself the thing it returns to.
  const focusDropdown = React.useCallback((el: HTMLDivElement | null) => {
    if (el) window.setTimeout(() => el.focus(), 0);
  }, []);
  const shown = isString ? `"${display}"` : display;
  return (
    <Popover
      opened={opened}
      onChange={onChange}
      position="bottom-start"
      withinPortal
      shadow="md"
      // Without this, closing on a click outside a focusable element drops
      // focus to <body>.
      returnFocus
    >
      <Popover.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size={16}
          c="var(--atelier-text-ghost)"
          aria-label={ariaLabel}
          tabIndex={tabIndex}
          onClick={(e) => {
            e.stopPropagation();
            onChange(true);
          }}
          style={{
            position: 'absolute',
            right: 2,
            top: '50%',
            transform: 'translateY(-50%)',
            opacity: visible ? 1 : 0,
            pointerEvents: visible ? 'auto' : 'none',
            borderRadius: 3,
            background: 'var(--atelier-surface-raised)',
            fontSize: 'var(--atelier-fs-xs)',
            lineHeight: '16px',
          }}
        >
          ⤢
        </ActionIcon>
      </Popover.Target>
      {/* Named "Full value" rather than after its trigger: Mantine labels the
          dialog by the trigger's id by default, and the trigger's name is an
          action ("Expand cell value"), not what the dialog holds. */}
      <Popover.Dropdown
        ref={focusDropdown}
        aria-labelledby={labelId}
        // Mantine closes on Escape in the capture phase; this stops the key
        // there so no row, grid or panel handler also sees it.
        onKeyDown={(e) => {
          if (e.key === 'Escape') e.stopPropagation();
        }}
      >
        <VisuallyHidden id={labelId}>Full value</VisuallyHidden>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--atelier-gap-sm)',
            marginBottom: 6,
            fontSize: 'var(--atelier-fs-xs)',
            color: 'var(--atelier-text-muted)',
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fieldPath}
          </span>
          {typeLabel && <span>{typeLabel}</span>}
          <span>{display.length.toLocaleString('en-US')} chars</span>
        </div>
        <div
          style={{
            maxWidth: 360,
            maxHeight: '60vh',
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 'var(--atelier-fs-xs)',
            color: 'var(--atelier-text)',
          }}
        >
          {shown}
        </div>
        <div style={{ display: 'flex', gap: 'var(--atelier-gap-xs)', marginTop: 8 }}>
          <Button
            size="compact-xs"
            variant="default"
            onClick={() => void copyToClipboard(display, 'Value copied to the clipboard.')}
          >
            Copy
          </Button>
          {onOpenInEditor && (
            <Button
              size="compact-xs"
              variant="default"
              onClick={() => {
                onChange(false);
                onOpenInEditor();
              }}
            >
              Open in editor
            </Button>
          )}
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}
