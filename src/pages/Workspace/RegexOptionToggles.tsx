import { themeVars as T } from '../../theme/themeVars';
import { REGEX_OPTIONS, toggleRegexOption } from './regexOptions';

/**
 * The `$regex` options as four buttons under the pattern box (the "a pattern
 * with options" board). A lit button is a letter sent as `$options`.
 */
export function RegexOptionToggles({
  options,
  readOnly,
  onChange,
  placement,
}: {
  options: string;
  readOnly: boolean;
  onChange: (next: string) => void;
  placement: React.CSSProperties;
}) {
  return (
    <div role="group" aria-label="Pattern options" style={{ ...placement, display: 'flex', gap: T.gapXs }}>
      {REGEX_OPTIONS.map(({ letter, label }) => {
        const on = options.includes(letter);
        return (
          <button
            key={letter}
            type="button"
            aria-pressed={on}
            aria-label={label}
            title={label}
            disabled={readOnly}
            onClick={() => onChange(toggleRegexOption(options, letter))}
            style={{
              minWidth: 28,
              height: 24,
              padding: '0 6px',
              fontFamily: 'monospace',
              fontSize: T.fsXs,
              cursor: readOnly ? 'default' : 'pointer',
              color: on ? T.accentInk : T.textGhost,
              background: on ? T.accentSoft : T.surface,
              border: `1px solid ${on ? T.accentBorder : T.border}`,
              borderRadius: T.rs,
            }}
          >
            {letter}
          </button>
        );
      })}
    </div>
  );
}
