import React from 'react';
import { Anchor, Button, Group, Loader, Progress, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconCheck } from '@tabler/icons-react';
import { api, getErrorMessage } from '../../api/atelier';
import { Wordmark } from '../../components/Wordmark';
import { notify } from '../../theme/notifications';
import { themeVars } from '../../theme/themeVars';
import { logFailure } from '../../utils/rendererLog';
import { openLink, restartToUpdate } from './updateActions';
import {
  CHANGELOG_URL,
  RELEASES_URL,
  checkedLine,
  identityLine,
  offReasonText,
  statusCard,
  type StatusCard,
} from './updateFormat';
import { useMinuteClock, useUpdateState } from './updateStateContext';
import { useWhatsNew } from './whatsNewContext';

const CARD_COLORS = {
  accent: { background: themeVars.accentSoft, border: themeVars.accentBorder },
  neutral: { background: themeVars.surfaceRaised, border: themeVars.border },
  warning: { background: themeVars.warnSoft, border: themeVars.warnBorder },
} as const;

/** Settings → About and updates (X22 §5): identity, the status card, the Check button and two links. */
export function AboutUpdatesSection() {
  const state = useUpdateState();
  const whatsNew = useWhatsNew();
  // Refreshed every minute while the section is open.
  const now = useMinuteClock();
  const [pending, setPending] = React.useState(false);
  // Null until main answers, and for good if it fails: the line then shows the version alone.
  const [info, setInfo] = React.useState<{ platform: string; arch: string } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    api.app
      .getInfo()
      .then((i) => {
        if (!cancelled) setInfo(i);
      })
      .catch((err) => logFailure('reading the app info', err));
    return () => {
      cancelled = true;
    };
  }, []);

  const check = async () => {
    setPending(true);
    try {
      await api.updates.check();
    } catch (err) {
      notify.error(getErrorMessage(err, 'Could not check for updates.'));
    } finally {
      setPending(false);
    }
  };

  const card = statusCard(state, __APP_VERSION__, now);
  const off = state.status === 'off' ? state : null;
  const checkDisabled = off !== null || state.status === 'checking' || pending;

  return (
    <>
      <Group gap="sm" align="center" wrap="nowrap">
        <Wordmark size={22} />
        <Text size="sm" c="dimmed" data-testid="about-version">
          {info ? identityLine(__APP_VERSION__, info.platform, info.arch) : `Version ${__APP_VERSION__}`}
        </Text>
      </Group>

      {card && <Card card={card} onRestart={() => void restartToUpdate()} onRetry={() => void check()} retryDisabled={checkDisabled} />}

      <Stack gap="xs">
        <Group gap="sm" wrap="nowrap" align="center">
          <Button variant="default" size="compact-sm" onClick={() => void check()} disabled={checkDisabled}>
            Check for updates
          </Button>
          {off === null && (
            <Text size="xs" c="dimmed" data-testid="about-checked-line">
              {checkedLine(state, now)}
            </Text>
          )}
        </Group>
        {off !== null && (
          <Text size="xs" c="dimmed" data-testid="about-off-reason">
            {off.reason === 'linux' ? (
              <>
                Updates aren&apos;t available on Linux yet. Download new versions from{' '}
                <Anchor
                  component="button"
                  type="button"
                  size="xs"
                  onClick={() => openLink(RELEASES_URL, 'Could not open the releases page')}
                >
                  GitHub
                </Anchor>
                .
              </>
            ) : (
              offReasonText(off.reason)
            )}
          </Text>
        )}
      </Stack>

      <Stack gap="xs" align="flex-start">
        <Anchor component="button" type="button" size="sm" onClick={whatsNew.open}>
          What&apos;s new in {__APP_VERSION__}
        </Anchor>
        <Anchor
          component="button"
          type="button"
          size="sm"
          onClick={() => openLink(CHANGELOG_URL, 'Could not open the changelog')}
        >
          Full release history on GitHub
        </Anchor>
      </Stack>
    </>
  );
}

function Card({
  card,
  onRestart,
  onRetry,
  retryDisabled,
}: {
  card: StatusCard;
  onRestart: () => void;
  onRetry: () => void;
  retryDisabled: boolean;
}) {
  const T = themeVars;
  const colors = CARD_COLORS[card.tone];
  return (
    <div
      data-testid="about-status-card"
      data-tone={card.tone}
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: T.gapMd,
        padding: T.gapMd,
        background: colors.background,
        border: `1px solid ${colors.border}`,
        borderRadius: T.r,
      }}
    >
      {card.spinner && <Loader size="xs" aria-hidden="true" />}
      {card.icon === 'check' && <IconCheck size={16} aria-hidden="true" />}
      {card.icon === 'warning' && <IconAlertTriangle size={16} aria-hidden="true" />}
      <Stack gap="var(--atelier-gap-xs)" style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" fw={600}>
          {card.title}
        </Text>
        {card.percent !== null && (
          <Group gap="xs" wrap="nowrap">
            <Progress value={card.percent} style={{ flex: 1 }} size={6} aria-label="Download progress" />
            <Text size="xs">{card.percent}%</Text>
          </Group>
        )}
        {card.detail && (
          <Text size="xs" c="dimmed">
            {card.detail}
          </Text>
        )}
      </Stack>
      {card.action === 'restart' && (
        <Button size="compact-sm" onClick={onRestart}>
          Restart now
        </Button>
      )}
      {card.action === 'retry' && (
        <Button size="compact-sm" variant="default" onClick={onRetry} disabled={retryDisabled}>
          Try again
        </Button>
      )}
    </div>
  );
}
