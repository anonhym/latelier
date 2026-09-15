import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { TroubleshootingProvider } from '../../src/troubleshooting/TroubleshootingProvider';
import { useTroubleshooting } from '../../src/troubleshooting/TroubleshootingContext';
import type {
  RecipeActionHandlers,
  RecipeMatchInput,
} from '../../src/troubleshooting/types';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

function Harness({
  input,
  actions,
}: {
  input: RecipeMatchInput;
  actions?: RecipeActionHandlers;
}) {
  return (
      <TroubleshootingProvider>
        <Opener input={input} actions={actions} />
      </TroubleshootingProvider>
  );
}

function Opener({
  input,
  actions,
}: {
  input: RecipeMatchInput;
  actions?: RecipeActionHandlers;
}) {
  const help = useTroubleshooting();
  return <button onClick={() => help.open(input, actions)}>open</button>;
}

// docker-tls input — its first step has suggestedAction: 'retryWithoutTls'.
const DOCKER_TLS_INPUT: RecipeMatchInput = {
  errorCode: 'TIMEOUT',
  message: 'connect ECONNRESET 127.0.0.1:27017',
};

// auth-default — none of its steps have suggestedAction.
const AUTH_INPUT: RecipeMatchInput = { errorCode: 'AUTH' };

describe('TroubleshootingDrawer — action button gating', () => {
  it('renders no button when the recipe step has a suggestedAction but no handler is provided', async () => {
    installAtelierMock({});
    render(<Harness input={DOCKER_TLS_INPUT} />);
    await userEvent.click(screen.getByText('open'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(screen.queryByText(/Retry without TLS/)).toBeNull();
  });

  it('renders the button when a matching handler is provided', async () => {
    installAtelierMock({});
    render(
      <Harness
        input={DOCKER_TLS_INPUT}
        actions={{ retryWithoutTls: async () => true }}
      />,
    );
    await userEvent.click(screen.getByText('open'));
    await waitFor(() => expect(screen.getByText(/Retry without TLS/)).toBeTruthy());
  });

  it('renders no button for recipes whose steps have no suggestedAction, even if handlers are provided', async () => {
    installAtelierMock({});
    render(
      <Harness
        input={AUTH_INPUT}
        actions={{
          retryWithoutTls: async () => true,
          retryDirectConnection: async () => true,
        }}
      />,
    );
    await userEvent.click(screen.getByText('open'));
    await waitFor(() => expect(screen.getByText('Authentication failed')).toBeTruthy());
    expect(screen.queryByText(/Retry without TLS/)).toBeNull();
    expect(screen.queryByText(/Retry with Direct connection/)).toBeNull();
  });

  it('clicks the handler exactly once and closes the drawer when it resolves true', async () => {
    installAtelierMock({});
    const handler = vi.fn(async () => true);
    render(<Harness input={DOCKER_TLS_INPUT} actions={{ retryWithoutTls: handler }} />);

    await userEvent.click(screen.getByText('open'));
    const btn = await screen.findByText(/Retry without TLS/);
    await userEvent.click(btn);

    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the drawer open when the handler resolves false', async () => {
    installAtelierMock({});
    const handler = vi.fn(async () => false);
    render(<Harness input={DOCKER_TLS_INPUT} actions={{ retryWithoutTls: handler }} />);

    await userEvent.click(screen.getByText('open'));
    const btn = await screen.findByText(/Retry without TLS/);
    await userEvent.click(btn);

    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('keeps the drawer open when the handler throws', async () => {
    installAtelierMock({});
    const handler = vi.fn(async () => {
      throw new Error('boom');
    });
    render(<Harness input={DOCKER_TLS_INPUT} actions={{ retryWithoutTls: handler }} />);

    await userEvent.click(screen.getByText('open'));
    const btn = await screen.findByText(/Retry without TLS/);
    await userEvent.click(btn);

    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
