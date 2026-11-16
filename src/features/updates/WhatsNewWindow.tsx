import React from 'react';
import { Badge, Button, Modal, UnstyledButton } from '@mantine/core';
import { api } from '../../api/atelier';
import { I } from '../../icons';
import { notify } from '../../theme/notifications';
import { themeVars } from '../../theme/themeVars';
import { summarizeRelease, type Release } from './changelog';
import {
  FULL_CHANGELOG_URL,
  formatReleaseDate,
  splitLead,
  whatsNewSubtitle,
} from './whatsNewFormat';

const T = themeVars;

export interface WhatsNewWindowProps {
  /** Newest first. The first one is shown open, the rest collapsed. */
  releases: Release[];
  currentVersion: string;
  /** The version the user updated from; null when reopened by hand. */
  from: string | null;
  onClose: () => void;
}

function ReleaseHeading({ release, current }: { release: Release; current: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: T.gapSm }}>
      <span style={{ fontSize: T.fsLg, fontWeight: 600, color: T.text }}>
        {release.version}
        {release.date ? ` · ${formatReleaseDate(release.date)}` : ''}
      </span>
      {current && (
        <Badge size="sm" variant="light">
          Current
        </Badge>
      )}
    </div>
  );
}

function ReleaseBody({ release, details }: { release: Release; details: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: T.gapMd, marginTop: T.gapSm }}>
      {release.preamble.map((p) => (
        <p key={p} style={{ margin: 0, fontSize: T.fsMd, color: T.text, lineHeight: 1.5 }}>
          {p}
        </p>
      ))}
      {release.groups.map((g) => {
        // The short view lists leads only; a leadless item waits for Show details.
        const items = details ? g.items : g.items.filter((i) => i.lead !== null);
        if (items.length === 0) return null;
        return (
          <section key={g.name}>
            <h3
              style={{
                margin: `0 0 ${T.gapXs}`,
                fontSize: T.fsSm,
                fontWeight: 600,
                color: T.textMuted,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
              }}
            >
              {g.name}
            </h3>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: T.gapXs }}>
              {items.map((item) => {
                const { strong, rest } = splitLead(item);
                return (
                  <li key={item.text} style={{ fontSize: T.fsMd, color: T.text, lineHeight: 1.5 }}>
                    {details ? (
                      <>
                        {strong && <strong>{strong}</strong>}
                        {rest}
                      </>
                    ) : (
                      <strong style={{ fontWeight: 500 }}>{item.lead}</strong>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function OlderRelease({
  release,
  current,
  details,
}: {
  release: Release;
  current: boolean;
  details: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const bodyId = `whats-new-${release.version}`;
  const label = [release.version, release.date ? formatReleaseDate(release.date) : null, summarizeRelease(release)]
    .filter((s) => s !== null)
    .join(' · ');
  return (
    <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: T.gapSm }}>
      <UnstyledButton
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: T.gapXs,
          font: 'inherit',
          fontSize: T.fsMd,
          color: T.text,
          width: '100%',
        }}
      >
        <span style={{ color: T.textGhost, display: 'flex', flexShrink: 0 }}>{open ? I.chevD : I.chevR}</span>
        {label}
        {current && (
          <Badge size="sm" variant="light">
            Current
          </Badge>
        )}
      </UnstyledButton>
      {open && (
        <div id={bodyId}>
          <ReleaseBody release={release} details={details} />
        </div>
      )}
    </div>
  );
}

/** The "What's new in L'Atelier" dialog (X22 §6.3). Controlled: the provider decides when it mounts. */
export function WhatsNewWindow({ releases, currentVersion, from, onClose }: WhatsNewWindowProps) {
  const [details, setDetails] = React.useState(false);
  const [newest, ...older] = releases;

  const openChangelog = () => {
    api.app.openExternal(FULL_CHANGELOG_URL).catch(() => {
      notify.error('Could not open the changelog');
    });
  };

  return (
    <Modal
      opened
      onClose={onClose}
      title="What's new in L'Atelier"
      size={560}
      centered
      // Dismissal is the footer's Got it, the close button or Escape; a stray
      // click on the backdrop should not lose release notes read once.
      closeOnClickOutside={false}
      closeButtonProps={{ 'aria-label': 'Close', 'data-autofocus': true } as React.ComponentProps<typeof Modal>['closeButtonProps']}
      styles={{
        content: { display: 'flex', flexDirection: 'column', maxHeight: 'min(640px, calc(100dvh - 80px))' },
        body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 0 },
      }}
    >
      <div style={{ padding: `0 ${T.gapLg} ${T.gapSm}`, fontSize: T.fsSm, color: T.textMuted }}>
        {whatsNewSubtitle(from, currentVersion, releases.length)}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: `${T.gapSm} ${T.gapLg} ${T.gapMd}`,
          display: 'flex',
          flexDirection: 'column',
          gap: T.gapMd,
        }}
      >
        {newest ? (
          <div>
            <ReleaseHeading release={newest} current={newest.version === currentVersion} />
            <ReleaseBody release={newest} details={details} />
          </div>
        ) : (
          <div style={{ fontSize: T.fsMd, color: T.textMuted }}>No release notes for this version.</div>
        )}
        {newest && (
          <div>
            <Button
              variant="subtle"
              size="compact-sm"
              aria-expanded={details}
              onClick={() => setDetails((d) => !d)}
            >
              {details ? 'Hide details' : 'Show details'}
            </Button>
          </div>
        )}
        {older.map((r) => (
          <OlderRelease key={r.version} release={r} current={r.version === currentVersion} details={details} />
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: `${T.gapMd} ${T.gapLg}`,
          borderTop: `1px solid ${T.border}`,
        }}
      >
        <Button variant="default" size="compact-sm" onClick={openChangelog}>
          Full changelog ↗
        </Button>
        <Button size="compact-sm" onClick={onClose}>
          Got it
        </Button>
      </div>
    </Modal>
  );
}
