/* eslint-disable react-refresh/only-export-components */
// Test-only helper: Fast-Refresh's "one component per file" rule doesn't
// apply to test infrastructure that isn't loaded by Vite.
import { type ReactNode } from 'react';
import {
  render as rtlRender,
  renderHook as rtlRenderHook,
  screen,
  within,
  type RenderHookOptions,
  type RenderHookResult,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { mantineTheme } from '../../src/theme/mantineTheme';

// X12 Phase 1: component tests render bare components that now reach for
// MantineProvider via Mantine's primitives. Wrap every render in the same
// theme provider App.tsx mounts so tests match the runtime tree.
// X12 Phase 2: also mount Notifications so notify.error/success calls
// render their toast DOM and tests can assert on the surfaced message.
// X12 Phase 5: env="test" makes Mantine's <Transition> render mounted
// content synchronously instead of waiting on rAF, so Spotlight's Modal
// (and any other transitioned overlay) shows up before the test asserts.
// W15 §13: ModalsProvider too — App.tsx mounts it and the drawer's
// Reset confirm goes through `modals.openConfirmModal`, which is a no-op
// without the provider's context.
function MantineTestProvider({ children }: { children: ReactNode }) {
  return (
    <MantineProvider theme={mantineTheme} env="test">
      <ModalsProvider>
        <Notifications />
        {children}
      </ModalsProvider>
    </MantineProvider>
  );
}

export function render(
  ui: Parameters<typeof rtlRender>[0],
  options?: RenderOptions,
): RenderResult {
  return rtlRender(ui, { wrapper: MantineTestProvider, ...options });
}

/**
 * Same providers as `render`, for hooks.
 *
 * RTL's own `renderHook` used to arrive through the `export *` below, wrapped
 * in nothing — which is invisible until a hook reaches for a provider. A change
 * moved `closeForNamespace`'s confirm onto the modal manager, and its spec
 * failed with "Unable to find role=dialog" rather than anything pointing at the
 * missing `ModalsProvider`. The named export below shadows the star re-export,
 * so every hook spec gets the runtime tree without opting in.
 */
export function renderHook<Result, Props>(
  hook: (initialProps: Props) => Result,
  options?: RenderHookOptions<Props>,
): RenderHookResult<Result, Props> {
  return rtlRenderHook(hook, { wrapper: MantineTestProvider, ...options });
}

/**
 * Queries scoped to the TitleBar — the first row of the AppShell header.
 *
 * The row and not the whole banner: since X16.2 the tab strip lives in
 * the same header and carries a chip naming each Connection, so a banner-wide
 * query for a Connection name matches a chip as readily as the TitleBar, and a
 * negative assertion ("this Connection is not the one we are browsing") would
 * pass or fail for the wrong reason.
 */
export function titleBar(): ReturnType<typeof within> {
  const row = screen.getByRole('banner').firstElementChild;
  if (!(row instanceof HTMLElement)) {
    throw new Error(
      'titleBar(): the AppShell header has no first-row element. If a row was ' +
        'added above TitleBar, scope to that row instead.',
    );
  }
  return within(row);
}

export * from '@testing-library/react';
