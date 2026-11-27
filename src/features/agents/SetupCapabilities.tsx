import React from 'react';
import { Button, Code, Collapse, Switch, UnstyledButton } from '@mantine/core';
import { api, getErrorMessage } from '../../api/atelier';
import { notify } from '../../theme/notifications';
import { themeVars } from '../../theme/themeVars';
import type { AgentAccessState } from '@shared/types';
import { AGENT_ACCESS_COPY } from '../agentAccess/agentAccessCopy';
import { homeStatusLine } from './homeModel';
import { LIMITS, NEVER, PROMPTS, TOOL_GROUPS } from './capabilitiesCopy';

const T = themeVars;

function Card({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  const id = React.useId();
  return (
    <section
      aria-labelledby={id}
      style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.r, padding: '14px 16px', ...style }}
    >
      <h2 id={id} style={{ margin: '0 0 10px', fontSize: T.fsMd, fontWeight: 600 }}>
        {label}
      </h2>
      {children}
    </section>
  );
}

/** The Agent Access switch and its one status line: Setup & capabilities and Settings both draw it. */
export function AgentAccessSwitch({ state }: { state: AgentAccessState }) {
  const [busy, setBusy] = React.useState(false);
  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      // On: main asks first; the pushed state says what is now in force, a cancel included.
      await (next ? api.agentAccess.requestEnable() : api.agentAccess.disable());
    } catch (err) {
      notify.error(getErrorMessage(err, 'Could not change Agent Access.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: themeVars.gapMd }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: T.fsMd, fontWeight: 600 }}>{AGENT_ACCESS_COPY.switchLabel}</div>
        <div data-testid="agent-access-status" style={{ fontSize: T.fsSm, color: T.textMuted }}>
          {homeStatusLine(state)}
        </div>
      </div>
      <Switch
        aria-label={AGENT_ACCESS_COPY.switchLabel}
        checked={state.enabled}
        disabled={busy}
        onChange={(e) => void toggle(e.currentTarget.checked)}
      />
    </div>
  );
}

/** Setup & capabilities (X30 §7), from the gear in the Agents sidebar. */
export function SetupCapabilities({ state }: { state: AgentAccessState }) {
  const [troubleOpen, setTroubleOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);

  const removeBridge = async () => {
    setRemoving(true);
    try {
      await api.agentAccess.removeBridge();
    } catch (err) {
      notify.error(getErrorMessage(err, 'Could not remove the bridge.'));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div data-testid="agents-setup-capabilities" style={{ display: 'flex', flexDirection: 'column', gap: themeVars.gapLg }}>
      <div>
        <h1 style={{ margin: 0, fontSize: T.fsLg, fontWeight: 600 }}>Setup &amp; capabilities</h1>
        <p style={{ margin: '4px 0 0', fontSize: T.fsSm, color: T.textMuted }}>
          The tools L&apos;Atelier offers to every connected Agent, and the limits it enforces. An Agent&apos;s client lists the same
          tools under “latelier”.
        </p>
      </div>

      <Card label="Agent Access">
        <AgentAccessSwitch state={state} />
      </Card>

      <Card label="Bridge">
        <div style={{ display: 'flex', alignItems: 'center', gap: themeVars.gapMd }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: T.fsSm }}>
            <div data-testid="agents-bridge-state">{state.bridgeInstalled ? 'Installed' : 'Not installed'}</div>
            {state.bridgePath && (
              <Code style={{ userSelect: 'text', wordBreak: 'break-all', display: 'inline-block', marginTop: 4 }}>{state.bridgePath}</Code>
            )}
          </div>
          {state.bridgeInstalled && (
            <Button size="xs" variant="default" loading={removing} onClick={() => void removeBridge()}>
              {AGENT_ACCESS_COPY.removeBridge}
            </Button>
          )}
        </div>
      </Card>

      <section style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.r, padding: '10px 16px' }}>
        <UnstyledButton
          aria-expanded={troubleOpen}
          aria-controls="agents-troubleshooting"
          onClick={() => setTroubleOpen((v) => !v)}
          style={{ fontSize: T.fsMd, fontWeight: 600, display: 'flex', alignItems: 'center', gap: themeVars.gapXs }}
        >
          <span aria-hidden style={{ color: T.textGhost, fontSize: T.fsXs }}>
            {troubleOpen ? '▾' : '▸'}
          </span>
          Troubleshooting
        </UnstyledButton>
        <Collapse expanded={troubleOpen}>
          <div id="agents-troubleshooting" style={{ paddingTop: 8, display: 'flex', flexDirection: 'column', gap: themeVars.gapXs, fontSize: T.fsSm }}>
            <div>
              Socket:{' '}
              {state.socketPath ? (
                <Code style={{ userSelect: 'text', wordBreak: 'break-all' }}>{state.socketPath}</Code>
              ) : (
                <span style={{ color: T.textMuted }}>not listening while Agent Access is off</span>
              )}
            </div>
            {state.platformCaveat === 'windows-pipe' && (
              <div data-testid="agent-windows-caveat" style={{ color: T.textMuted }}>
                {AGENT_ACCESS_COPY.windowsCaveat}
              </div>
            )}
          </div>
        </Collapse>
      </section>

      <Card label="What an Agent can do">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: themeVars.gapMd }}>
          {TOOL_GROUPS.map((g) => (
            <div key={g.title} style={{ border: `1px solid ${T.border}`, borderRadius: T.r, padding: '14px 16px' }}>
              <h3 style={{ margin: '0 0 8px', fontSize: T.fsMd, fontWeight: 600 }}>{g.title}</h3>
              <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: themeVars.gapSm }}>
                {g.tools.map((tool) => (
                  <div key={tool.names.join()}>
                    <dt style={{ fontFamily: 'var(--atelier-font-mono, monospace)', fontSize: T.fsSm, color: T.accentInk }}>
                      {tool.names.join(' · ')}
                    </dt>
                    <dd style={{ margin: 0, fontSize: T.fsSm, color: T.textMuted }}>{tool.desc}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        <h3 style={{ margin: '16px 0 8px', fontSize: T.fsMd, fontWeight: 600 }}>Limits on every call</h3>
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: themeVars.gapMd }}>
          {LIMITS.map((l) => (
            <div key={l.value}>
              <dt style={{ fontSize: themeVars.fsLg, fontWeight: 600 }}>{l.value}</dt>
              <dd style={{ margin: 0, fontSize: T.fsSm, color: T.textMuted }}>{l.caption}</dd>
            </div>
          ))}
        </dl>
        <p style={{ margin: '12px 0 0', fontSize: T.fsSm, color: T.textMuted }}>
          Every Agent operation carries the comment <Code>latelier-agent</Code>, so it is easy to find in currentOp, the profiler and
          the slow-query log.
        </p>
      </Card>

      <section
        aria-labelledby="agents-never-heading"
        style={{ background: T.redSoft, border: `1px solid ${T.redBorder}`, borderRadius: T.r, padding: '14px 16px' }}
      >
        <h2 id="agents-never-heading" style={{ margin: '0 0 10px', fontSize: T.fsMd, fontWeight: 600 }}>
          What an Agent never does
        </h2>
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: themeVars.gapSm,
            fontSize: T.fsSm,
          }}
        >
          {NEVER.map((n) => (
            <li key={n}>
              <span aria-hidden style={{ color: T.red, fontWeight: 600, marginRight: 6 }}>
                ✕
              </span>
              {n}
            </li>
          ))}
        </ul>
      </section>

      <Card label="Prompts that work">
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: themeVars.gapXs, fontSize: T.fsSm }}>
          {PROMPTS.map((p) => (
            <li key={p}>“{p}”</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
