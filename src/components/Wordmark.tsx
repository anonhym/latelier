import { themeVars } from '../theme/themeVars';

interface WordmarkProps {
  size?: number;
}

// Ligature wordmark used in title bars: `L` (900) + violet dot + `Atelier` (300).
// Mirrors the SVG splash mark so the in-app branding matches the loading screen.
export function Wordmark({ size = 16 }: WordmarkProps) {
  const T = themeVars;
  const dotSize = Math.round(size * 0.375);
  return (
    <span
      aria-label="L'Atelier"
      style={{ display: 'inline-flex', alignItems: 'baseline', gap: 0, lineHeight: 1 }}
    >
      <span
        style={{
          fontWeight: 900,
          fontSize: size,
          letterSpacing: '-0.04em',
          color: T.text,
          fontFamily: '"Inter", system-ui, sans-serif',
        }}
      >
        L
      </span>
      <span
        aria-hidden="true"
        style={{
          width: dotSize,
          height: dotSize,
          background: '#7c6af7',
          borderRadius: '50%',
          alignSelf: 'flex-start',
          marginTop: Math.round(size * 0.19),
          marginLeft: 1,
          marginRight: 1,
          flexShrink: 0,
          display: 'inline-block',
        }}
      />
      <span
        style={{
          fontWeight: 300,
          fontSize: size,
          letterSpacing: '-0.04em',
          color: T.text,
          fontFamily: '"Inter", system-ui, sans-serif',
        }}
      >
        Atelier
      </span>
    </span>
  );
}
