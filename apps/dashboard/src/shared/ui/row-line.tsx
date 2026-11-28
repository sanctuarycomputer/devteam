// A row of a list (layout.css: .rowline, .rowline .t): what the view puts in it (a dot, span.t, span.r),
// in one line. One that opens a record carries data-open, tabindex 0 and role link.
import type { KeyboardEventHandler, MouseEventHandler, ReactNode } from 'react';

export type RowLineProps = {
  className?: string;
  tabIndex?: number;
  role?: 'link' | 'button';
  data?: Record<string, string>;
  onClick?: MouseEventHandler<HTMLDivElement>;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  children?: ReactNode;
};

export default function RowLine({ className, tabIndex, role, data, onClick, onKeyDown, children }: RowLineProps) {
  const dataAttrs = Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]));
  return (
    <div className={['rowline', className ?? ''].filter(Boolean).join(' ')} {...dataAttrs} tabIndex={tabIndex} role={role} onClick={onClick} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}
