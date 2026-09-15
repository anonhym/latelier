import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '../helpers/render';
import { OperatorTooltip } from '../../src/features/fieldSuggestions/OperatorTooltip';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';

describe('OperatorTooltip', () => {
  beforeEach(() => {
    installAtelierMock();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    uninstallAtelierMock();
  });

  function openTooltip(): HTMLElement {
    const anchor = screen.getByTestId('anchor');
    fireEvent.mouseEnter(anchor);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    return anchor;
  }

  it('opens after the open delay on mouse enter', () => {
    render(
      <OperatorTooltip name="$match" prefClass="stage" placement="below">
        <span data-testid="anchor">$match</span>
      </OperatorTooltip>,
    );

    // Nothing before the timer.
    const anchor = screen.getByTestId('anchor');
    fireEvent.mouseEnter(anchor);
    expect(screen.queryByLabelText(/Documentation for/)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(screen.queryByLabelText(/Documentation for/)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByLabelText('Documentation for $match')).toBeTruthy();
  });

  it('closes after the close delay on mouse leave', () => {
    render(
      <OperatorTooltip name="$match" prefClass="stage">
        <span data-testid="anchor">$match</span>
      </OperatorTooltip>,
    );
    const anchor = openTooltip();
    expect(screen.getByLabelText('Documentation for $match')).toBeTruthy();

    fireEvent.mouseLeave(anchor);
    act(() => {
      vi.advanceTimersByTime(99);
    });
    expect(screen.queryByLabelText('Documentation for $match')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByLabelText('Documentation for $match')).toBeNull();
  });

  it('cancels pending close when re-entering within the delay', () => {
    render(
      <OperatorTooltip name="$match" prefClass="stage">
        <span data-testid="anchor">$match</span>
      </OperatorTooltip>,
    );
    const anchor = openTooltip();
    fireEvent.mouseLeave(anchor);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    fireEvent.mouseEnter(anchor);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByLabelText('Documentation for $match')).toBeTruthy();
  });

  it('opens on focus and closes on blur', () => {
    render(
      <OperatorTooltip name="$match" prefClass="stage">
        <span data-testid="anchor" tabIndex={0}>$match</span>
      </OperatorTooltip>,
    );
    const anchor = screen.getByTestId('anchor');
    fireEvent.focus(anchor);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByLabelText('Documentation for $match')).toBeTruthy();

    fireEvent.blur(anchor);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByLabelText('Documentation for $match')).toBeNull();
  });

  it('closes immediately on Escape', () => {
    render(
      <OperatorTooltip name="$match" prefClass="stage">
        <span data-testid="anchor" tabIndex={0}>$match</span>
      </OperatorTooltip>,
    );
    const anchor = openTooltip();
    fireEvent.keyDown(anchor, { key: 'Escape' });
    expect(screen.queryByLabelText('Documentation for $match')).toBeNull();
  });

  it('does not open when the operator has no description', () => {
    render(
      <OperatorTooltip name="$doesNotExist">
        <span data-testid="anchor">$nope</span>
      </OperatorTooltip>,
    );
    const anchor = screen.getByTestId('anchor');
    fireEvent.mouseEnter(anchor);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByLabelText(/Documentation for/)).toBeNull();
  });

  it('uses prefClass to resolve the correct catalog entry', () => {
    render(
      <OperatorTooltip name="$eq" prefClass="query">
        <span data-testid="anchor">$eq</span>
      </OperatorTooltip>,
    );
    openTooltip();
    expect(screen.getByText(/Class: query operator/)).toBeTruthy();
  });
});
