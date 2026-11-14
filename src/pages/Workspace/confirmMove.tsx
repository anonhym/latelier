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
      // Mantine's content element is focusable (tabIndex -1) and takes focus
      // when the text is clicked: it carries the marker too, or Escape there
      // reaches the editor's own listener.
      attributes: { content: stop },
      // On the modal root, so a key pressed with focus anywhere in the prompt
      // (its content element included) is answered here.
      onKeyDown: (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          answer('stay');
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          if (opts.canSave) answer('save');
        }
      },
      onClose: () => resolve('stay'),
      children: (
        <div {...stop}>
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
