import React from 'react';
import { Button, UnstyledButton } from '@mantine/core';
import { api, getErrorMessage, isIpcError } from '../../api/atelier';
import { themeVars } from '../../theme/themeVars';
import { Wordmark } from '../../components/Wordmark';
import { logFailure } from '../../utils/rendererLog';
import {
  CONNECTION_FORM_DEFAULTS,
  applyParsedUri,
  formToConnectionInput,
} from '../../features/connections/connectionFormState';
import { probeResultToText } from '../../features/connections/connectionStatus';
import { connectionNameFromUri, redactUriSecrets } from '../../features/connections/welcomeName';
import { useTroubleshooting } from '../../troubleshooting/TroubleshootingContext';
import type { RecipeMatchInput } from '../../troubleshooting/types';

interface WelcomeCanvasProps {
  /** The canvas has saved a Connection: the host lists it and connects it. */
  onSaved: (id: string) => void;
  /** Opens the connection form. */
  onEnterManually: () => void;
  /** Opens the Import Wizard: on a file, or on pasted URIs. */
  onImport: (source?: 'paste') => void;
}

const LINKS: ReadonlyArray<{ label: string; source?: 'paste' | 'form' }> = [
  { label: 'Enter details manually', source: 'form' },
  { label: 'Import from Compass or a file' },
  { label: 'Paste several URIs', source: 'paste' },
];

/**
 * What the Data View shows while no Connection is saved (C03 §13.1): one URI
 * field that parses, tests, saves and connects.
 *
 * The URI is a secret input: it can carry a password. Its text lives in this
 * component's state and nowhere else, it reaches main only through
 * `conn:parseUri`, `conn:test` and `conn:create`, and every message shown has
 * the credentials taken out of it.
 */
export function WelcomeCanvas({ onSaved, onEnterManually, onImport }: WelcomeCanvasProps) {
  const T = themeVars;
  const help = useTroubleshooting();
  const [uri, setUri] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<RecipeMatchInput | null>(null);
  const [keychain, setKeychain] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    // The line is a promise about the keychain, so it is shown only once main says the keychain holds the key.
    api.secrets
      .status()
      .then(({ columnKeyProtected }) => {
        if (live) setKeychain(columnKeyProtected);
      })
      // No answer, no promise: the line stays hidden. Nothing here carries the URI.
      .catch((err: unknown) => logFailure('welcome: secrets.status', err));
    return () => {
      live = false;
    };
  }, []);

  const connect = async () => {
    const text = uri.trim();
    if (text === '' || busy) return;
    setBusy(true);
    setError(null);
    setFailure(null);
    let password: string | undefined;
    const fail = (message: string) => setError(redactUriSecrets(message, text, password));
    try {
      const parsed = await api.conn.parseUri(text);
      const form = applyParsedUri(CONNECTION_FORM_DEFAULTS, parsed.input);
      password = form.password || undefined;

      // Named before the test, not after: main validates the whole input, name included.
      const taken = (await api.conn.list()).map((c) => c.name);
      const input = formToConnectionInput({ ...form, name: connectionNameFromUri(form.host, taken) });

      const probe = await api.conn.test(input);
      if (!probe.ok) {
        fail(probeResultToText(probe));
        setFailure({
          errorCode: probe.errorCode,
          message: probe.errorMessage && redactUriSecrets(probe.errorMessage, text, password),
        });
        return;
      }

      const created = await api.conn.create(input);
      // Saved: the secret has no further reason to sit in this field.
      setUri('');
      onSaved(created.id);
    } catch (err) {
      fail(
        isIpcError(err) && err.code === 'SECRETS_UNAVAILABLE'
          ? 'The system keychain is unavailable, so this password cannot be saved. Enter details manually to choose how to store it.'
          : getErrorMessage(err, 'Could not connect.'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="welcome-canvas"
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'auto',
        padding: 24,
        background: T.bg,
      }}
    >
      <div style={{ width: 560, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: T.gapLg }}>
        <Wordmark size={32} />
        <h1 style={{ margin: 0, fontSize: T.fsLg, fontWeight: 600, color: T.text }}>Connect to MongoDB</h1>
        <form
          style={{ display: 'flex' }}
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          <input
            aria-label="Connection string"
            aria-invalid={error !== null}
            aria-describedby={error !== null ? 'welcome-uri-error' : undefined}
            value={uri}
            onChange={(e) => {
              setUri(e.target.value);
              setError(null);
              setFailure(null);
            }}
            placeholder="mongodb://localhost:27017  or  mongodb+srv://…"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            readOnly={busy}
            aria-busy={busy}
            style={{
              flex: 1,
              minWidth: 0,
              height: 40,
              padding: '0 12px',
              fontFamily: 'ui-monospace, monospace',
              fontSize: T.fsMd,
              color: T.text,
              background: T.surface,
              border: `1px solid ${error !== null ? T.redBorder : T.borderMed}`,
              borderRight: 'none',
              borderRadius: `${T.rs} 0 0 ${T.rs}`,
              outlineOffset: -2,
            }}
          />
          <Button
            type="submit"
            loading={busy}
            disabled={uri.trim() === ''}
            style={{ height: 40, borderRadius: `0 ${T.rs} ${T.rs} 0` }}
          >
            Connect
          </Button>
        </form>
        {error !== null && (
          <div id="welcome-uri-error" role="alert" style={{ fontSize: T.fsSm, color: T.redText }}>
            {error}
            {failure && (
              <>
                {' '}
                <UnstyledButton
                  onClick={() => help.open(failure)}
                  style={{ fontSize: T.fsSm, color: T.accentInk, textDecoration: 'underline' }}
                >
                  Troubleshoot
                </UnstyledButton>
              </>
            )}
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: T.gapSm, fontSize: T.fsSm, color: T.textMuted }}>
          {LINKS.map(({ label, source }, i) => (
            <React.Fragment key={label}>
              {i > 0 && <span aria-hidden>·</span>}
              <UnstyledButton
                onClick={() => (source === 'form' ? onEnterManually() : onImport(source))}
                style={{ fontSize: T.fsSm, color: T.accentInk }}
              >
                {label}
              </UnstyledButton>
            </React.Fragment>
          ))}
        </div>
        {keychain && (
          <div style={{ fontSize: T.fsSm, color: T.textMuted }}>
            Passwords are encrypted with your system keychain and never leave this machine.
          </div>
        )}
      </div>
    </div>
  );
}
