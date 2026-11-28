// A button, as today's markup writes one (shell.css css-common: button, button.ghost; css-chrome: .icon-btn).
// Solid by default (no class); ghost; icon-btn for an icon alone. An attribute whose prop isn't given isn't
// written: most of today's buttons have no type.
import type { MouseEventHandler, ReactNode } from 'react';

export type ButtonProps = {
  kind?: 'solid' | 'ghost';
  icon?: boolean;
  type?: 'button' | 'submit';
  id?: string;
  title?: string;
  label?: string;
  hidden?: boolean;
  className?: string;
  role?: string;
  pressed?: boolean;
  disabled?: boolean;
  tabIndex?: number;
  data?: Record<string, string>;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  children?: ReactNode;
};

export default function Button({ kind = 'solid', icon = false, type, id, title, label, hidden, className, role, pressed, disabled, tabIndex, data, onClick, children }: ButtonProps) {
  const cls = [kind === 'ghost' ? 'ghost' : '', icon ? 'icon-btn' : '', className ?? ''].filter(Boolean).join(' ');
  const dataAttrs = Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]));
  return (
    <button type={type} id={id} title={title} aria-label={label} hidden={hidden} className={cls || undefined} role={role} aria-pressed={pressed} disabled={disabled} tabIndex={tabIndex} {...dataAttrs} onClick={onClick}>
      {children}
    </button>
  );
}
