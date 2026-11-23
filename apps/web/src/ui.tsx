import { useId, type ReactNode } from 'react';

const PATHS = {
  play: 'M8 5v14l11-7z',
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  prev: 'M7 6h2v12H7zM10 12l8 6V6z',
  next: 'M15 6h2v12h-2zM6 18l8-6-8-6z',
  loop: 'M7 7h10v3l4-4-4-4v3H5v6h2zM17 17H7v-3l-4 4 4 4v-3h12v-6h-2z',
  up: 'M7 14l5-5 5 5z',
  down: 'M7 10l5 5 5-5z',
  close: 'M6.4 5L5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  undo: 'M12.5 8c-2.65 0-5.05 1-6.9 2.6L2 7v9h9l-3.62-3.62A7.95 7.95 0 0 1 20.4 16l2.37-.78A10.5 10.5 0 0 0 12.5 8z',
  redo: 'M18.4 10.6A10.46 10.46 0 0 0 11.5 8 10.5 10.5 0 0 0 1.23 15.22L3.6 16a7.96 7.96 0 0 1 13.02-3.62L13 16h9V7z',
  grip: 'M9 6h2v2H9zm4 0h2v2h-2zM9 11h2v2H9zm4 0h2v2h-2zm-4 5h2v2H9zm4 0h2v2h-2z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  warn: 'M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z',
  error: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2zm0-4h-2V7h2z',
  spark: 'M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z',
  upload: 'M5 20h14v-2H5zm0-10h4v6h6v-6h4l-7-7z',
  folder: 'M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8z',
  download: 'M5 20h14v-2H5zM19 9h-4V3H9v6H5l7 7z',
  safe: 'M3 3h18v18H3zm2 2v14h14V5zm3 3h8v8H8z',
  trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z',
  volume: 'M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.47 4.47 0 0 0 2.5-4z',
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} fill="currentColor" />
    </svg>
  );
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className ?? ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size,
}: {
  value: T;
  options: readonly { value: T; label: ReactNode; title?: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  label: string;
  size?: 'sm';
}) {
  const name = useId();
  return (
    <div className={`segmented ${size ?? ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={o.value} className={o.value === value ? 'on' : ''} title={o.title}>
          <input type="radio" name={name} value={o.value} checked={o.value === value} disabled={o.disabled} onChange={() => onChange(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  onReset,
  dataPath,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  onReset?: (() => void) | undefined;
  dataPath?: string;
}) {
  return (
    <label className="slider">
      <span className="slider-head">
        <span className="field-label">{label}</span>
        <span className="slider-value">
          {format ? format(value) : value}
          {onReset ? (
            <button type="button" className="link" onClick={(e) => (e.preventDefault(), onReset())}>
              reset
            </button>
          ) : null}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} data-path={dataPath} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Empty({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children ? <div>{children}</div> : null}
    </div>
  );
}

export function LevelIcon({ level }: { level: 'pass' | 'warn' | 'fail' | 'error' }) {
  return (
    <span className={`level level-${level}`}>
      <Icon name={level === 'pass' ? 'check' : level === 'warn' ? 'warn' : 'error'} size={15} />
    </span>
  );
}

export function fmtTime(t: number): string {
  const s = Math.max(0, t);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

export function fmtBytes(n: number): string {
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} kB`;
}

export function StepHeader({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <header className="step-head">
      <span className="step-num lg">{n}</span>
      <h2>{title}</h2>
      {children ? <div className="step-head-extra">{children}</div> : null}
    </header>
  );
}
