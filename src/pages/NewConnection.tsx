import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { DarkCtx, useTheme } from '../ThemeContext';
import { themeVars } from '../theme/themeVars';
import { I } from '../icons';
import { ConnectionForm } from '../features/connections/ConnectionForm';
import { TitleBarBackLink } from '../components/TitleBarBackLink';

export default function NewConnection() {
  const [dark, toggle] = useTheme();
  const T = themeVars;
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ id?: string }>();
  const isEdit = Boolean(params.id);
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;
  const backTarget = isEdit ? returnTo ?? `/connections/${params.id}` : '/workspace';
  const backLabel = isEdit ? (returnTo === '/workspace' ? 'Data View' : 'Connection') : 'Data View';
  const sharedFormProps = {
    onSaved: (id: string) => navigate(backTarget, {
      replace: true,
      state: isEdit ? undefined : { openConnectionId: id },
    }),
    onCancel: () => navigate(backTarget),
  };

  return (
    <DarkCtx.Provider value={dark}>
      <div style={{
        height: '100vh', display: 'flex', flexDirection: 'column',
        background: T.bg, color: T.text,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: 13,
      }}>
        <div style={{
          height: 46, display: 'flex', alignItems: 'center', gap: 12,
          padding: '0 16px', borderBottom: `1px solid ${T.border}`,
          background: T.surface, flexShrink: 0,
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}>
          <div style={{ width: 70, flexShrink: 0 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <TitleBarBackLink label={backLabel} onClick={() => navigate(backTarget)} />
            <span style={{ color: T.textGhost }}>/</span>
            <span style={{ color: T.textMuted, fontSize: 13 }}>
              {isEdit ? 'Edit Connection' : 'New Connection'}
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={toggle} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, border: `1px solid ${T.border}`, borderRadius: T.rs,
            background: T.surfaceRaised, color: T.textMuted, cursor: 'pointer',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}>
            {dark ? I.sun : I.moon}
          </button>
        </div>

        {/* `key` forces a remount per target — without it, switching create↔edit at the same route reconciles and keeps stale form values. */}
        {params.id
          ? <ConnectionForm key={params.id} mode="edit" connectionId={params.id} {...sharedFormProps} />
          : <ConnectionForm key="new" mode="create" {...sharedFormProps} />}
      </div>
    </DarkCtx.Provider>
  );
}
