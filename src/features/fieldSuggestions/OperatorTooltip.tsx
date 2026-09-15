import React from 'react';
import { createPortal } from 'react-dom';
import { findOperatorDocs, type OperatorClass } from './operators';
import { OperatorDocPanel } from './OperatorDocPanel';
import {
  OPERATOR_PANEL_SIZE,
  placeFloatingPanel,
  type Placement,
} from './placement';

interface OperatorTooltipProps {
  /** Operator name, e.g. '$eq'. Resolved via findOperatorDocs. */
  name: string;
  /** Preferred class for duplicate-name disambiguation. */
  prefClass?: OperatorClass;
  /** The anchor element. Rendered as-is; the tooltip attaches to its rect. */
  children: React.ReactElement;
  /** Preferred placement. Default 'below'. */
  placement?: Placement;
  /** Open delay in ms. Default 200. */
  openDelay?: number;
  /** Close delay in ms. Default 100. */
  closeDelay?: number;
}

export function OperatorTooltip({
  name,
  prefClass,
  children,
  placement = 'below',
  openDelay = 200,
  closeDelay = 100,
}: OperatorTooltipProps) {
  const op = React.useMemo(() => findOperatorDocs(name, prefClass), [name, prefClass]);
  const hasDocs = !!op && !!op.description;

  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const anchorRef = React.useRef<HTMLElement | null>(null);
  const openTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (openTimer.current) clearTimeout(openTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const doOpen = React.useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const p = placeFloatingPanel(
      { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      OPERATOR_PANEL_SIZE,
      placement,
    );
    setPos({ top: p.top, left: p.left });
    setOpen(true);
  }, [placement]);

  const startOpen = React.useCallback(() => {
    if (!hasDocs) return;
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (open) return;
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => {
      doOpen();
    }, openDelay);
  }, [hasDocs, open, openDelay, doOpen]);

  const startClose = React.useCallback(() => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (!open) return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), closeDelay);
  }, [open, closeDelay]);

  const closeImmediate = React.useCallback(() => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(false);
  }, []);

  const child = React.Children.only(children);
  const childProps = (child as React.ReactElement<Record<string, unknown>>).props;
  const mergedProps: Record<string, unknown> = {
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node;
      const ref = (child as unknown as { ref?: React.Ref<HTMLElement> }).ref;
      if (typeof ref === 'function') ref(node);
      else if (ref && typeof ref === 'object') {
        (ref as { current: HTMLElement | null }).current = node;
      }
    },
    onMouseEnter: (e: React.MouseEvent) => {
      (childProps.onMouseEnter as ((e: React.MouseEvent) => void) | undefined)?.(e);
      startOpen();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      (childProps.onMouseLeave as ((e: React.MouseEvent) => void) | undefined)?.(e);
      startClose();
    },
    onFocus: (e: React.FocusEvent) => {
      (childProps.onFocus as ((e: React.FocusEvent) => void) | undefined)?.(e);
      startOpen();
    },
    onBlur: (e: React.FocusEvent) => {
      (childProps.onBlur as ((e: React.FocusEvent) => void) | undefined)?.(e);
      startClose();
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      (childProps.onKeyDown as ((e: React.KeyboardEvent) => void) | undefined)?.(e);
      if (e.key === 'Escape') closeImmediate();
    },
  };

  const clone = React.cloneElement(child, mergedProps as Partial<typeof childProps>);

  const tooltip =
    open && hasDocs && pos && typeof document !== 'undefined'
      ? createPortal(
          <div
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              zIndex: 1002,
            }}
            onMouseEnter={() => {
              if (closeTimer.current) {
                clearTimeout(closeTimer.current);
                closeTimer.current = null;
              }
            }}
            onMouseLeave={startClose}
          >
            <OperatorDocPanel op={op} variant="tooltip" />
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {clone}
      {tooltip}
    </>
  );
}
