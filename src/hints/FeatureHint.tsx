import React from 'react';
import { ActionIcon, Button, Group, Paper, Portal, Stack, Text } from '@mantine/core';
import { I } from '../icons';
import { HINT_REGISTRY } from './registry';
import type { FeatureHintId } from '@shared/types';

const POPOVER_WIDTH = 280;

interface FeatureHintProps {
  id: FeatureHintId;
  visible: boolean;
  onDismiss: () => void;
  onCta?: () => void;
  /** Override the default `[data-hint-anchor="<id>"]` lookup. */
  anchorSelector?: string;
}

// Discovers an anchor element via [data-hint-anchor="<id>"] (or override),
// then renders a positioned Paper popover centered below it. Mantine handles
// theming + dark mode via CSS variables; positioning stays manual because
// the anchor isn't a React child of the hint — it's an arbitrary DOM element
// elsewhere in the tree.
export function FeatureHint({
  id,
  visible,
  onDismiss,
  onCta,
  anchorSelector,
}: FeatureHintProps) {
  const copy = HINT_REGISTRY[id];
  const selector = anchorSelector ?? `[data-hint-anchor="${id}"]`;
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);

  React.useEffect(() => {
    if (!visible) return;
    const update = () => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const top = r.bottom + 8;
      const left = Math.max(
        8,
        Math.min(
          window.innerWidth - POPOVER_WIDTH - 8,
          r.left + r.width / 2 - POPOVER_WIDTH / 2,
        ),
      );
      setPos({ top, left });
    };
    const raf = requestAnimationFrame(update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [visible, selector]);

  if (!visible || !pos) return null;

  return (
    <Portal>
      <Paper
        role="dialog"
        aria-label={copy.title}
        data-feature-hint={id}
        shadow="lg"
        withBorder
        radius="md"
        style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          width: POPOVER_WIDTH,
          zIndex: 1200,
          padding: '12px 14px',
        }}
      >
        <Group align="flex-start" gap="xs" wrap="nowrap">
          <Stack gap={4} style={{ flex: 1 }}>
            <Text size="sm" fw={600}>
              {copy.title}
            </Text>
            <Text size="xs" c="dimmed" lh={1.45}>
              {copy.body}
            </Text>
          </Stack>
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={onDismiss}
            aria-label="Dismiss hint"
          >
            {I.close}
          </ActionIcon>
        </Group>
        <Group gap="xs" justify="flex-end" mt="xs">
          {copy.ctaLabel && onCta && (
            <Button
              size="compact-xs"
              variant="light"
              onClick={() => {
                onCta();
                onDismiss();
              }}
            >
              {copy.ctaLabel}
            </Button>
          )}
          <Button size="compact-xs" variant="subtle" onClick={onDismiss}>
            Got it
          </Button>
        </Group>
      </Paper>
    </Portal>
  );
}
