import { IconPlugConnected } from '@tabler/icons-react';
import { useSettings } from '../../pages/SettingsContext';
import { themeVars } from '../../theme/themeVars';
import { indicatorLabel } from './agentAccessCopy';
import { useAgentAccessState } from './useAgentAccessState';

/** The status bar's "Agents · N" (X27 §12.2): nothing while Agent Access is off, a button to its Settings while on. */
export function AgentStatusIndicator() {
  const state = useAgentAccessState();
  const settings = useSettings();
  if (!state?.enabled) return null;
  return (
    <button
      type="button"
      data-testid="agent-status"
      aria-label={indicatorLabel(state.sessionReadCount)}
      onClick={() => settings.open('agents')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: themeVars.gapXs,
        padding: '0 4px',
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        cursor: 'pointer',
      }}
    >
      <IconPlugConnected size={12} aria-hidden="true" />
      <span aria-hidden="true">Agents · {state.sessionReadCount}</span>
    </button>
  );
}
