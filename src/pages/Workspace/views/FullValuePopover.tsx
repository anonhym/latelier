import { Popover } from '@mantine/core';

interface FullValuePopoverProps {
  /** The value's display text, untruncated. */
  display: string;
  /** Strings are shown quoted, so `"1"` and `1` stay distinguishable. */
  isString: boolean;
  opened: boolean;
  onChange: (opened: boolean) => void;
  /** Hover/focus-revealed: the trigger is always mounted, but invisible and
   * click-through until the host says it should show. */
  visible: boolean;
  ariaLabel?: string;
}

/**
 * The `⤢` affordance that opens a read-only popover with a value's full,
 * untruncated text. Shared by Table cells and Tree/expanded-row leaves. The
 * trigger is absolutely positioned at the right edge of its host, which must
 * be `position: relative`. Its own `stopPropagation` keeps a click from also
 * selecting, expanding or activating the row underneath.
 */
export function FullValuePopover({
  display,
  isString,
  opened,
  onChange,
  visible,
  ariaLabel = 'Expand cell value',
}: FullValuePopoverProps) {
  return (
    <Popover
      opened={opened}
      onChange={onChange}
      position="bottom-start"
      withinPortal
      shadow="md"
      // Without this, closing on a click outside a focusable element drops
      // focus to <body>. Safe here because the dropdown has no focusable
      // content to autofocus (see `FieldsControl`'s comment for why an
      // autofocus would break this).
      returnFocus
    >
      <Popover.Target>
        <button
          aria-label={ariaLabel}
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
            width: 16,
            height: 16,
            padding: 0,
            border: 'none',
            borderRadius: 3,
            background: 'var(--atelier-surface-raised)',
            color: 'var(--atelier-text-ghost)',
            cursor: 'pointer',
            fontSize: 10,
            lineHeight: '16px',
          }}
        >
          ⤢
        </button>
      </Popover.Target>
      <Popover.Dropdown>
        <div
          style={{
            maxWidth: 320,
            maxHeight: 240,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 11,
            color: 'var(--atelier-text)',
          }}
        >
          {isString ? `"${display}"` : display}
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}
