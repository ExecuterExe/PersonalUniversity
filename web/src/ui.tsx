// Общие элементы интерфейса: карточки, кнопки, метки, сообщения, пустые состояния.
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'lg';
  icon?: ReactNode;
};

export function Button({
  variant = 'primary',
  size,
  icon,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    variant === 'primary' ? '' : variant,
    size ?? '',
    children ? '' : 'icon',
    className,
  ];
  return (
    <button type="button" className={classes.filter(Boolean).join(' ')} {...rest}>
      {icon}
      {children}
    </button>
  );
}

export function Card({
  title,
  icon,
  action,
  children,
  className = '',
  style,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={`card ${className}`} style={style}>
      {(title || action) && (
        <div className="card-head">
          <div className="icon-title">
            {icon}
            {title && <h2>{title}</h2>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

const ALERT_ICON = {
  info: <Info size={18} />,
  warning: <AlertTriangle size={18} />,
  danger: <XCircle size={18} />,
  success: <CheckCircle2 size={18} />,
};

export function Alert({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  children: ReactNode;
}) {
  return (
    <div className={`alert ${tone}`}>
      {ALERT_ICON[tone]}
      <div>{children}</div>
    </div>
  );
}

export function ErrorText({ error }: { error: string | null | undefined }) {
  return error ? <p className="error-text">{error}</p> : null;
}

/** Пока данные грузятся — мягкие «заготовки» вместо пустоты. */
export function Loading({ error, height = 120 }: { error?: string | null; height?: number }) {
  if (error) return <Alert tone="danger">{error}</Alert>;
  return (
    <div className="stack">
      <div className="skeleton" style={{ height: 36, width: '40%' }} />
      <div className="skeleton" style={{ height }} />
    </div>
  );
}

export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone?: 'primary' | 'violet' | 'success' | 'warning' | 'danger';
  children: ReactNode;
}) {
  return <span className={`badge ${tone ?? ''}`}>{children}</span>;
}

export function Progress({
  value,
  accent,
  label,
}: {
  value: number;
  accent?: boolean;
  label?: string;
}) {
  return (
    <div
      className={`progress ${accent ? 'accent' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.max(0, Math.min(1, value)) * 100)}
      aria-label={label}
      title={label}
    >
      <span style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="field">
      {label}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/** Вариант выбора — строка с кружком. */
export function Option({
  on,
  onClick,
  disabled,
  children,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`option ${on ? 'on' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="radio" />
      <span className="grow">{children}</span>
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({
  icon,
  label,
  value,
  note,
}: {
  icon?: ReactNode;
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="card stat">
      <span className="label">
        {icon}
        {label}
      </span>
      <span className="value">{value}</span>
      {note && <span className="note">{note}</span>}
    </div>
  );
}
