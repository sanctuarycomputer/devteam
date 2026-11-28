// A badge: a tint of a status colour, the word always in it (shell.css css-common: .badge and its tones).
import type { ReactNode } from 'react';

export type BadgeProps = {
  tone?: 'high' | 'critical' | 'important' | 'medium' | 'minor' | 'low' | 'good';
  id?: string;
  title?: string;
  hidden?: boolean;
  className?: string;
  data?: Record<string, string>;
  children?: ReactNode;
};

export default function Badge({ tone, id, title, hidden, className, data, children }: BadgeProps) {
  const dataAttrs = Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]));
  return (
    <span className={['badge', tone ?? '', className ?? ''].filter(Boolean).join(' ')} id={id} title={title} hidden={hidden} {...dataAttrs}>
      {children}
    </span>
  );
}
