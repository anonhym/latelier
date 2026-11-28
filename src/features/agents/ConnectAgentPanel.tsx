import React from 'react';
import { Button, Loader, TextInput, UnstyledButton } from '@mantine/core';
import { IconChevronLeft } from '@tabler/icons-react';
import { api, getErrorMessage } from '../../api/atelier';
import { notify } from '../../theme/notifications';
import { themeVars } from '../../theme/themeVars';
import type { AgentAccessState, SnippetClient } from '@shared/types';
import { AGENT_CLIENT_OPTIONS, DEFAULT_AGENT_CLIENT } from '../agentAccess/agentClients';
import { sessionWhere, type AgentsPage } from './agentsPage';
import { clock } from './agentsTime';
import {
  AGENT_NAME_MAX,
  canCopy,
  clipboardClearAt,
  connectDraft,
  copyRequest,
  copyStepDone,
  firstSessionOf,
  type ConnectDrafts,
  type ConnectPanelAction,
} from './connectPanel';
import { PASTE_WHERE, TOKEN_PLACEHOLDER } from './connectCopy';
import { announceCopied, clientLabel } from './useAgentTokenActions';

const T = themeVars;

function StepNumber({ n, done }: { n: number; done: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        boxSizing: 'border-box',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: T.fsSm,
        fontWeight: 600,
        ...(done
          ? { background: T.greenDot, color: '#fff' }
          : { border: `1.5px solid ${T.accent}`, background: T.accentSoft, color: T.accentInk }),
      }}
    >
      {done ? '✓' : n}
    </span>
  );
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: React.ReactNode }) {
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr)', gap: themeVars.gapMd }} data-testid={`connect-step-${n}`} data-done={done || undefined}>
      <StepNumber n={n} done={done} />
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: themeVars.gapSm }}>
        <h2 style={{ margin: 0, fontSize: T.fsMd, fontWeight: 600, lineHeight: '24px' }}>{title}</h2>
        {children}
      </div>
    </li>
  );
}

/** The client choice: a tablist with one tab stop, arrows moving and choosing. */
function ClientChoice({ value, onChange }: { value: SnippetClient; onChange: (c: SnippetClient) => void }) {
  const refs = React.useRef(new Map<SnippetClient, HTMLButtonElement>());
  const onKeyDown = (e: React.KeyboardEvent) => {
    const at = AGENT_CLIENT_OPTIONS.findIndex((o) => o.value === value);
    const n = AGENT_CLIENT_OPTIONS.length;
    let next = -1;
    if (e.key === 'ArrowRight') next = (at + 1) % n;
    else if (e.key === 'ArrowLeft') next = (at + n - 1) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    const c = AGENT_CLIENT_OPTIONS[next]!.value;
    onChange(c);
    refs.current.get(c)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label="Client"
      onKeyDown={onKeyDown}
      style={{ display: 'inline-flex', flexWrap: 'wrap', gap: themeVars.gapXs, padding: 2, borderRadius: T.rs, background: T.surfaceRaised, alignSelf: 'flex-start' }}
    >
      {AGENT_CLIENT_OPTIONS.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              if (el) refs.current.set(o.value, el);
              else refs.current.delete(o.value);
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.value)}
            style={{
              border: 0,
              borderRadius: T.rx,
              padding: '4px 10px',
              fontSize: T.fsSm,
              cursor: 'pointer',
              background: selected ? T.surface : 'transparent',
              color: selected ? T.text : T.textMuted,
              fontWeight: selected ? 600 : 400,
              boxShadow: selected ? '0 1px 2px rgba(0,0,0,.08)' : undefined,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** The setup as main builds it, with the placeholder marked. Never a token. */
function SnippetBlock({ text }: { text: string }) {
  const parts = text.split(TOKEN_PLACEHOLDER);
  return (
    <pre
      data-testid="connect-snippet"
      style={{
        margin: 0,
        fontFamily: 'var(--atelier-font-mono, monospace)',
        fontSize: T.fsSm,
        lineHeight: 1.6,
        background: T.surfaceRaised,
        border: `1px solid ${T.border}`,
        borderRadius: T.r,
        padding: '12px 14px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        userSelect: 'text',
      }}
    >
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <mark style={{ background: T.accentSoft, color: T.accentInk, borderRadius: 3, padding: '0 2px' }}>{TOKEN_PLACEHOLDER}</mark>
          )}
          {p}
        </React.Fragment>
      ))}
    </pre>
  );
}

/**
 * Connect an Agent (X30 §6): name it, choose its client, copy the setup
 * (main asks, makes the token and writes the clipboard), paste it, and wait
 * for the first session. The token is never on screen or in the renderer.
 */
export function ConnectAgentPanel({
  state,
  tokenId,
  drafts,
  onAction,
  onNavigate,
}: {
  state: AgentAccessState;
  /** An existing Agent to copy the setup for again; none for a new one. */
  tokenId?: string;
  /** The panels of this run, held above the tab so they outlive this mount. */
  drafts: ConnectDrafts;
  onAction: (tokenId: string | undefined, action: ConnectPanelAction) => void;
  onNavigate: (page: AgentsPage) => void;
}) {
  const panel = connectDraft(drafts, tokenId, DEFAULT_AGENT_CLIENT);
  const dispatch = (action: ConnectPanelAction) => onAction(tokenId, action);
  const token = panel.tokenId ? state.tokens.find((t) => t.id === panel.tokenId) : undefined;
  const name = token?.name ?? panel.name.trim();
  const label = clientLabel(panel.client);
  const copied = copyStepDone(panel);
  // Copying again ends the Agent's live sessions, so any session after a copy here is a new one.
  const session = panel.copiedAt ? firstSessionOf(state.sessions, panel.tokenId) : null;

  const copy = async () => {
    const req = copyRequest(panel);
    const client = panel.client;
    dispatch({ type: 'copyStart' });
    try {
      const result =
        req.kind === 'connect'
          ? await api.agentAccess.connectClient({ name: req.name, client })
          : await api.agentAccess.copySetup({ id: req.id, client });
      dispatch({ type: 'copyDone', result, client });
      announceCopied(result, client, req.kind === 'connect' ? req.name : name);
    } catch (err) {
      dispatch({ type: 'copyFailed' });
      notify.error(getErrorMessage(err, 'Could not copy the setup.'));
    }
  };

  return (
    <div data-testid="connect-agent-panel" style={{ display: 'flex', flexDirection: 'column', gap: themeVars.gapLg, maxWidth: 760 }}>
      <UnstyledButton
        onClick={() => onNavigate({ kind: 'home' })}
        style={{ display: 'inline-flex', alignItems: 'center', gap: themeVars.gapXs, color: T.textMuted, fontSize: T.fsSm, alignSelf: 'flex-start' }}
      >
        <IconChevronLeft size={14} aria-hidden="true" />
        Agents
      </UnstyledButton>

      <div>
        <h1 style={{ margin: 0, fontSize: T.fsLg, fontWeight: 600, overflowWrap: 'anywhere' }}>
          {name ? `Connect “${name}”` : 'Connect an Agent'}
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: T.fsSm, color: T.textMuted }}>
          Name this Agent and pick the client it runs in. Each Agent has its own token.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: themeVars.gapSm }}>
        <TextInput
          size="xs"
          label="Name"
          placeholder="Work laptop"
          value={token?.name ?? panel.name}
          maxLength={AGENT_NAME_MAX}
          readOnly={!!panel.tokenId}
          onChange={(e) => dispatch({ type: 'name', name: e.currentTarget.value })}
          style={{ maxWidth: 320 }}
        />
        <ClientChoice value={panel.client} onChange={(client) => dispatch({ type: 'client', client })} />
      </div>

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: themeVars.gapLg }}>
        <Step n={1} done={copied} title="Copy the setup">
          {copied && panel.copiedAt ? (
            <div
              role="status"
              data-testid="connect-copied"
              style={{ background: T.greenSoft, border: `1px solid ${T.greenBorder}`, borderRadius: T.r, padding: '10px 12px', fontSize: T.fsSm }}
            >
              <div style={{ fontWeight: 600, color: T.greenText }}>✓ Copied to your clipboard at {clock(panel.copiedAt)}</div>
              <div style={{ marginTop: 4 }}>
                {label}&apos;s setup for “{name}”, with its new Agent Token, is in your clipboard. Paste it in step 2. The token is never
                shown on screen; L&apos;Atelier keeps only a hash of it.
              </div>
              <div style={{ marginTop: 4, color: T.textMuted }}>
                If it is still in your clipboard at {clock(clipboardClearAt(panel.copiedAt))}, L&apos;Atelier clears it.
              </div>
            </div>
          ) : (
            <div style={{ fontSize: T.fsSm, color: T.textMuted }}>
              {panel.tokenId
                ? `Makes a new token for this Agent, ends its live sessions, and puts ${label}'s setup, token included, in your clipboard.`
                : `Makes this Agent's token and puts ${label}'s setup, token included, in your clipboard.`}
            </div>
          )}
          <Button
            size="xs"
            variant={copied ? 'default' : 'filled'}
            style={{ alignSelf: 'flex-start' }}
            disabled={!canCopy(panel)}
            loading={panel.copying}
            onClick={() => void copy()}
          >
            {panel.tokenId ? 'Copy setup again…' : `Copy ${label} setup…`}
          </Button>
        </Step>

        <Step n={2} done={copied && !!session} title={`Paste it into ${label}`}>
          <div style={{ fontSize: T.fsSm, color: T.textMuted }}>{PASTE_WHERE[panel.client]}</div>
          <SnippetBlock text={state.snippetTemplates[panel.client]} />
          <div style={{ fontSize: T.fsXs, color: T.textGhost }}>
            What you pasted has your real token where this shows {TOKEN_PLACEHOLDER}.
          </div>
        </Step>

        <Step n={3} done={!!session} title={`Ask ${label} something`}>
          <div style={{ fontSize: T.fsSm, color: T.textMuted }}>
            Share a Connection and keep it open, then try “Which L&apos;Atelier connections can you see?”
          </div>
          {session ? (
            <div
              role="status"
              data-testid="connect-connected"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: themeVars.gapSm,
                background: T.greenSoft,
                border: `1px solid ${T.greenBorder}`,
                borderRadius: T.r,
                padding: '10px 12px',
                fontSize: T.fsSm,
              }}
            >
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: T.greenDot, flexShrink: 0 }} />
              <span style={{ color: T.greenText, fontWeight: 600, overflowWrap: 'anywhere' }}>
                Connected: {[session.clientName ?? label, session.clientVersion].filter(Boolean).join(' ')}
              </span>
              <Button
                size="compact-xs"
                variant="default"
                style={{ marginLeft: 'auto' }}
                onClick={() =>
                  onNavigate({ kind: 'session', sessionId: session.id, agentName: session.tokenName, where: sessionWhere(session), tokenId: session.tokenId })
                }
              >
                View session
              </Button>
            </div>
          ) : panel.copiedAt ? (
            <div
              role="status"
              data-testid="connect-waiting"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: themeVars.gapSm,
                border: `1px dashed ${T.accentBorder}`,
                background: T.accentSoft,
                borderRadius: T.r,
                padding: '10px 12px',
                fontSize: T.fsSm,
              }}
            >
              <Loader size={14} />
              <span>
                <span style={{ fontWeight: 600 }}>Waiting for {label} to connect with this token…</span>
                <br />
                <span style={{ color: T.textMuted }}>Restart {label} if it was already open. This turns green on the first connection.</span>
              </span>
            </div>
          ) : null}
        </Step>
      </ol>
    </div>
  );
}
