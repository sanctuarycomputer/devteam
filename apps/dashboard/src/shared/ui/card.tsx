// A card (layout.css: .card, .card.small, .card.flush; shell.css css-common: .card[data-open]). A grid span
// (c6) or a view's own class comes in className.
import type { KeyboardEventHandler, MouseEventHandler, ReactNode } from 'react';

export type CardProps = {
  small?: boolean;
  flush?: boolean;
  id?: string;
  title?: string;
  hidden?: boolean;
  className?: string;
  role?: string;
  label?: string;
  tabIndex?: number;
  data?: Record<string, string>;
  onClick?: MouseEventHandler<HTMLElement>;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  children?: ReactNode;
};

export default function Card({ small = false, flush = false, id, title, hidden, className, role, label, tabIndex, data, onClick, onKeyDown, children }: CardProps) {
  const dataAttrs = Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]));
  return (
    <div className={['card', small ? 'small' : '', flush ? 'flush' : '', className ?? ''].filter(Boolean).join(' ')} id={id} title={title} hidden={hidden} role={role} aria-label={label} tabIndex={tabIndex} {...dataAttrs} onClick={onClick} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}
