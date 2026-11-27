import React from 'react';
import { themeVars } from '../../theme/themeVars';

/**
 * The title bar's breadcrumb while the Agents tab is in front (X30 §4):
 * `Agents › {page}` or `Agents › {Agent} › {session}`. Plain text: Agent
 * names and folders came from the Agent's side.
 */
export function AgentsBreadcrumb({ crumbs }: { crumbs: readonly string[] }) {
  const T = themeVars;
  return (
    <nav
      aria-label="Location"
      data-testid="agents-breadcrumb"
      style={{ display: 'flex', alignItems: 'center', gap: T.gapXs, minWidth: 0, overflow: 'hidden', fontSize: T.fsSm }}
    >
      {crumbs.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <span aria-hidden style={{ color: T.textGhost, flexShrink: 0 }}>
              ›
            </span>
          )}
          <span
            title={c}
            aria-current={i === crumbs.length - 1 ? 'page' : undefined}
            style={{
              color: T.text,
              fontWeight: i === crumbs.length - 1 ? 600 : 400,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              minWidth: 0,
            }}
          >
            {c}
          </span>
        </React.Fragment>
      ))}
    </nav>
  );
}
