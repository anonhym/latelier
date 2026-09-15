import './Splash.css';
import wordmarkUrl from '../assets/atelier-wordmark-light.svg';

interface SplashProps {
  tagline?: string;
}

/**
 * Cold-start brand splash. Per X08 §3.4: a brief overlay shown while the
 * renderer mounts, dismissed automatically by the parent. Does not gate
 * any async work — providers mount immediately underneath.
 */
export function Splash({ tagline = 'Loading…' }: SplashProps) {
  return (
    <div className="atelier-splash" role="status" aria-live="polite" aria-label="Loading L'Atelier">
      <img
        src={wordmarkUrl}
        alt="L'Atelier"
        className="atelier-splash__wordmark"
        draggable={false}
      />
      <div className="atelier-splash__tagline">{tagline}</div>
      <div className="atelier-splash__progress" aria-hidden="true">
        <div className="atelier-splash__progress-bar" />
      </div>
    </div>
  );
}
