// A segmented control: a role=group of buttons, one pressed (layout.css: .seg; shell.css css-misc: .seg2,
// the compact one of a hold bar or a view bar). Its buttons are Buttons with pressed.
import type { ReactNode } from 'react';

export type SegmentedProps = {
  label: string;
  compact?: boolean;
  children?: ReactNode;
};

export default function Segmented({ label, compact = false, children }: SegmentedProps) {
  return <span className={compact ? 'seg2' : 'seg'} role="group" aria-label={label}>{children}</span>;
}
