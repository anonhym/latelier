import React from 'react';
import { I } from '../../icons';
import { themeVars } from '../../theme/themeVars';

export interface DividerNotchProps {
  side: 'left' | 'right';
  collapsed: boolean;
  onClick: () => void;
  ariaLabel: string;
  buttonRef?: React.Ref<HTMLButtonElement>;
}

export function DividerNotch({ side, collapsed, onClick, ariaLabel, buttonRef }: DividerNotchProps) {
  const T = themeVars;
  const pointsLeft = side === 'right' ? !collapsed : collapsed;
  return (
    <button
      type="button"
      ref={buttonRef}
      onClick={onClick}
      aria-label={ariaLabel}
      style={{
        position: 'absolute',
        top: '50%',
        transform: 'translateY(-50%)',
        [side]: -7,
        width: 14,
        height: 36,
        padding: 0,
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: side === 'right' ? '0 4px 4px 0' : '4px 0 0 4px',
        [side === 'right' ? 'borderLeft' : 'borderRight']: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: T.textMuted,
        zIndex: 10,
        boxShadow: T.shadow,
      } as React.CSSProperties}
    >
      {pointsLeft ? I.chevL : I.chevR}
    </button>
  );
}
