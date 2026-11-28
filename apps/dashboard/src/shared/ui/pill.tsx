// A pill (layout.css: .pill and its tones), as statusPill writes one; with badge, the "badge pill" of a
// card's pills (pillsOf), whose tones are the badge's, with an optional leading icon.
import type { ReactNode } from 'react';

export type PillProps = {
  tone?: 'green' | 'blue' | 'amber' | 'red' | 'high' | 'critical' | 'important' | 'medium' | 'minor' | 'low' | 'good';
  badge?: boolean;
  icon?: string;
  title?: string;
  className?: string;
  children?: ReactNode;
};

export default function Pill({ tone, badge = false, icon, title, className, children }: PillProps) {
  return (
    <span className={[badge ? 'badge' : '', 'pill', tone ?? '', className ?? ''].filter(Boolean).join(' ')} title={title}>
      {icon ? <i className={`icon-${icon}`} aria-hidden="true"></i> : null}
      {children}
    </span>
  );
}
