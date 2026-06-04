import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../../store/app-store';

// kepler.gl 風: speed は再生スピード倍率（1x = リアルタイム）
// GTFS データは数時間〜数日の範囲なので、デフォルトは 600x。
const SPEED_OPTIONS: number[] = [60, 300, 600, 1800, 3600];

// kepler.gl の "Trail Length" 相当。秒単位。
const TRAIL_PRESETS: { label: string; seconds: number }[] = [
  { label: '30s', seconds: 30 },
  { label: '1m', seconds: 60 },
  { label: '2m', seconds: 120 },
  { label: '5m', seconds: 300 },
  { label: '10m', seconds: 600 },
  { label: '30m', seconds: 1800 },
  { label: '1h', seconds: 3600 },
  { label: 'All', seconds: -1 }, // 全期間: 動的に bounds.max - bounds.min に置換
];

/** UTC ベースで YYYY-MM-DD HH:MM:SS にフォーマット。timezone 不問の表示。 */
function formatDateTime(unixSec: number): string {
  const t = Math.max(0, Math.floor(unixSec));
  const tod = t % 86400;
  const date = new Date(Math.floor(t / 86400) * 86400 * 1000);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const h = Math.floor(tod / 3600);
  const m = Math.floor((tod % 3600) / 60);
  const s = tod % 60;
  return `${yyyy}-${mm}-${dd} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function TimeBar() {
  const timeBounds = useAppStore(s => s.timeBounds);
  const currentTime = useAppStore(s => s.currentTime);
  const isPlaying = useAppStore(s => s.isPlaying);
  const playbackSpeed = useAppStore(s => s.playbackSpeed);
  const trailLength = useAppStore(s => s.trailLength);
  const fadeTrail = useAppStore(s => s.fadeTrail);
  const setCurrentTime = useAppStore(s => s.setCurrentTime);
  const setIsPlaying = useAppStore(s => s.setIsPlaying);
  const setPlaybackSpeed = useAppStore(s => s.setPlaybackSpeed);
  const setTrailLength = useAppStore(s => s.setTrailLength);
  const setFadeTrail = useAppStore(s => s.setFadeTrail);
  const generatedLayers = useAppStore(s => s.generatedLayers);
  const selectedLayer = useAppStore(s => s.selectedLayer);
  const matchingOutputLayer = useAppStore(s => s.matchingOutputLayer);

  // 表示中レイヤーがアニメーション対象か判定
  const displayedLayer = selectedLayer === 'matching' ? matchingOutputLayer : selectedLayer;
  const isAnimatable =
    displayedLayer === 'trips'
    || displayedLayer === 'matching-trips'
    || displayedLayer === 'matching-ridership';
  const hasContent = displayedLayer in generatedLayers
    && generatedLayers[displayedLayer]!.features.length > 0;

  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  useEffect(() => {
    if (!isPlaying || !timeBounds) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    lastTickRef.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      const cur = useAppStore.getState().currentTime;
      const speed = useAppStore.getState().playbackSpeed;
      const bounds = useAppStore.getState().timeBounds;
      if (!bounds) return;
      let next = cur + dt * speed;
      if (next > bounds.max) {
        next = bounds.min;  // ループ再生
      }
      setCurrentTime(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying, timeBounds, setCurrentTime]);

  const onSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentTime(Number(e.target.value));
  }, [setCurrentTime]);

  const onReset = useCallback(() => {
    if (timeBounds) setCurrentTime(timeBounds.min);
  }, [timeBounds, setCurrentTime]);

  if (!isAnimatable || !hasContent || !timeBounds) return null;

  const fullRange = timeBounds.max - timeBounds.min;

  // Trail プリセットの "All" は動的に全期間
  const onTrailChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = Number(e.target.value);
    setTrailLength(v < 0 ? fullRange : v);
  };
  const currentTrailValue = (() => {
    // どのプリセットに該当するか
    const match = TRAIL_PRESETS.find(p => p.seconds === trailLength);
    if (match) return String(match.seconds);
    if (trailLength >= fullRange) return '-1';
    return String(trailLength);
  })();

  // シーク中の進捗 %（背景グラデーション用）
  const pct = ((currentTime - timeBounds.min) / fullRange) * 100;

  return (
    <div className="time-bar">
      <div className="time-bar-controls">
        <button
          className="time-bar-btn time-bar-reset"
          onClick={onReset}
          title="Reset to start"
        >
          ⏮
        </button>
        <button
          className="time-bar-btn time-bar-play"
          onClick={() => setIsPlaying(!isPlaying)}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
      </div>
      <div className="time-bar-track">
        <span className="time-bar-time time-bar-current">
          {formatDateTime(currentTime)}
        </span>
        <input
          className="time-bar-slider"
          style={{
            background: `linear-gradient(to right,
              var(--color-accent, #4a9eff) 0%,
              var(--color-accent, #4a9eff) ${pct}%,
              rgba(255,255,255,0.15) ${pct}%,
              rgba(255,255,255,0.15) 100%)`,
          }}
          type="range"
          min={timeBounds.min}
          max={timeBounds.max}
          step={1}
          value={currentTime}
          onChange={onSeek}
        />
        <span className="time-bar-time time-bar-end">
          {formatDateTime(timeBounds.max)}
        </span>
      </div>
      <div className="time-bar-settings">
        <label className="time-bar-setting" title="Trail Length">
          <span className="time-bar-setting-label">Trail</span>
          <select className="time-bar-select" value={currentTrailValue} onChange={onTrailChange}>
            {TRAIL_PRESETS.map(p => (
              <option key={p.seconds} value={p.seconds}>{p.label}</option>
            ))}
          </select>
        </label>
        <label className="time-bar-setting" title="Fade Trail">
          <input
            type="checkbox"
            checked={fadeTrail}
            onChange={e => setFadeTrail(e.target.checked)}
          />
          <span className="time-bar-setting-label">Fade</span>
        </label>
        <label className="time-bar-setting" title="Playback Speed">
          <span className="time-bar-setting-label">Speed</span>
          <select
            className="time-bar-select"
            value={playbackSpeed}
            onChange={e => setPlaybackSpeed(Number(e.target.value))}
          >
            {SPEED_OPTIONS.map(s => (
              <option key={s} value={s}>{s}x</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
