// A banner across the page (shell.css css-base: .banner, .banner.stale, .banner.updated): a failure, a
// stale page or an update, with its role (alert or status).
import type { ReactNode } from 'react';

export type BannerProps = {
  tone?: 'stale' | 'updated';
  id?: string;
  role?: 'alert' | 'status';
  hidden?: boolean;
  className?: string;
  children?: ReactNode;
};

export default function Banner({ tone, id, role, hidden, className, children }: BannerProps) {
  return <div className={['banner', tone ?? '', className ?? ''].filter(Boolean).join(' ')} id={id} role={role} hidden={hidden}>{children}</div>;
}
