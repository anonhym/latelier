import React from 'react';
import { Button, Group, Popover, Progress, Stack, Text } from '@mantine/core';
import { IconDownload, IconRefresh } from '@tabler/icons-react';
import { api } from '../../api/atelier';
import { themeVars } from '../../theme/themeVars';
import { logFailure } from '../../utils/rendererLog';
import { openLink, restartToUpdate } from './updateActions';
import { clampPercent } from './updateFormat';
import { useRegisterUpdatePill, useUpdateState } from './updateStateContext';
import type { UpdateState } from '@shared/types';

const RESTORE_TABS_KEY = 'ui.workspace.restoreTabs';

type ReadyState = Extract<UpdateState, { status: 'ready' }>;

/**
 * The right end of the status bar (X22 §4): nothing while quiet, a muted
 * progress line while an update downloads, and an accent pill once one is
 * ready. The pill opens a popover; only its Restart now button restarts.
 */
export function UpdateStatusPill() {
  const state = useUpdateState();
  // Registered whatever the state, so the toast stands down wherever a pill could show it.
  useRegisterUpdatePill();
  if (state.status === 'downloading') return <DownloadingText version={state.version} percent={state.percent} />;
  if (state.status === 'ready') return <ReadyPill state={state} />;
  return null;
}

function DownloadingText({ version, percent }: { version: string; percent: number }) {
  const T = themeVars;
  const whole = clampPercent(percent);
  return (
    <span
      data-testid="update-downloading"
      style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: T.gapXs, color: T.textMuted }}
    >
      <IconDownload size={12} aria-hidden="true" />
      <span>Downloading {version}</span>
      <Progress value={whole} w={48} size={4} aria-label={`Download progress ${whole}%`} />
      <span>{whole}%</span>
    </span>
  );
}

function ReadyPill({ state }: { state: ReadyState }) {
  const T = themeVars;
  const titleId = React.useId();
  const [opened, setOpened] = React.useState(false);
  // Unset means on, as the Settings switch reads it.
  const [restoreTabs, setRestoreTabs] = React.useState(true);
  const [restarting, setRestarting] = React.useState(false);

  React.useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    api.prefs
      .get<boolean>(RESTORE_TABS_KEY)
      .then((v) => {
        if (!cancelled) setRestoreTabs(v !== false);
      })
      // The sentence about tabs is a courtesy: without it the popover is still right.
      .catch((err) => logFailure('reading the tab restore setting', err));
    return () => {
      cancelled = true;
    };
  }, [opened]);

  const close = () => setOpened(false);

  const onDismissKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || !opened) return;
    // Stopped so the key does not also reach whatever sits behind the pill.
    e.stopPropagation();
    close();
  };

  const restart = async () => {
    setRestarting(true);
    try {
      const willRestart = await restartToUpdate();
      // Cancelled or refused: the pill stays, the popover has done its job.
      if (!willRestart) close();
    } finally {
      setRestarting(false);
    }
  };

  const changes = state.changeCount;
  return (
    <Popover
      opened={opened}
      // Escape is handled below, where it can stop propagation.
      closeOnEscape={false}
      position="top-end"
      shadow="md"
      withinPortal
      returnFocus
      onChange={(next) => setOpened(next)}
    >
      <Popover.Target>
        <button
          type="button"
          data-testid="update-ready-pill"
          aria-haspopup="dialog"
          aria-expanded={opened}
          onClick={(e) => {
            e.stopPropagation();
            setOpened((o) => !o);
          }}
          onKeyDown={onDismissKey}
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: T.gapXs,
            height: 18,
            padding: '0 8px',
            font: 'inherit',
            cursor: 'pointer',
            color: T.accentInk,
            background: T.accentSoft,
            border: `1px solid ${T.accentBorder}`,
            borderRadius: T.rs,
          }}
        >
          <IconRefresh size={12} aria-hidden="true" />
          {state.version} ready · Restart
        </button>
      </Popover.Target>
      <Popover.Dropdown
        p="sm"
        w={300}
        role="dialog"
        aria-labelledby={titleId}
        // Portalled content still bubbles through the React tree to the status bar.
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onDismissKey}
      >
        <Stack gap="xs">
          <Text id={titleId} size="sm" fw={600}>
            Version {state.version} is ready
          </Text>
          <Text size="xs" c="dimmed">
            You&apos;re on {__APP_VERSION__}.{restoreTabs ? ' Restarting reopens your tabs.' : ''}
          </Text>
          {state.highlights.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: T.fsXs }}>
              {state.highlights.slice(0, 3).map((h, i) => (
                // A highlight can repeat, and the list never reorders.
                <li key={`${i}:${h}`}>{h}</li>
              ))}
            </ul>
          )}
          <Button
            variant="subtle"
            size="compact-xs"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => openLink(state.releaseUrl, 'Could not open the release notes')}
          >
            {changes === null ? 'Release notes' : `All ${changes} change${changes === 1 ? '' : 's'}`}
          </Button>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" size="compact-xs" onClick={close}>
              Later
            </Button>
            <Button size="compact-xs" onClick={() => void restart()} disabled={restarting}>
              Restart now
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
