import { Button, Group, Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { formatShortcut } from '../../commands/shortcutLabel';
import { isMacRenderer } from '../../utils/platform';

export type MoveChoice = 'stay' | 'discard' | 'save';

const MODAL_ID = 'document-editor-move-guard';

/**
 * W18 §13.5 — moving to another document with unsaved edits. Three answers,
 * where `confirmDestructive` has two. Escape and ⌘↵ are handled here, and the
 * controls carry Mantine's stop marker: the editor underneath listens for
 * Escape on `window` and would otherwise open its own "Discard changes?" on
 * top of this prompt.
 */
export function confirmMove(opts: { canSave: boolean }): Promise<MoveChoice> {
  return new Promise((resolve) => {
    const answer = (choice: MoveChoice) => {
      resolve(choice);
      modals.close(MODAL_ID);
    };
    const stop = { 'data-mantine-stop-propagation': 'true' } as const;
    modals.open({
      modalId: MODAL_ID,
      title: 'Unsaved changes',
      closeOnEscape: false,
      withCloseButton: false,
      onClose: () => resolve('stay'),
      children: (
        <div
          {...stop}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              answer('stay');
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              if (opts.canSave) answer('save');
            }
          }}
        >
          <Text size="sm">This document has edits that are not saved.</Text>
          <Group justify="flex-end" gap="xs" mt="md">
            <Button {...stop} data-autofocus variant="default" onClick={() => answer('stay')}>
              Stay
            </Button>
            <Button {...stop} variant="default" color="red" onClick={() => answer('discard')}>
              Discard and go
            </Button>
            <Button
              {...stop}
              disabled={!opts.canSave}
              onClick={() => answer('save')}
              rightSection={<kbd aria-hidden="true">{formatShortcut('⌘↵', isMacRenderer())}</kbd>}
            >
              Save and go
            </Button>
          </Group>
        </div>
      ),
    });
  });
}
