// A stat tile (shell.css css-common: .stat, .stat span, .stat b): its label, its figure and, on some
// pages, a line under it, as the view writes them.
import type { ReactNode } from 'react';

export type StatProps = {
  title?: string;
  children?: ReactNode;
};

export default function Stat({ title, children }: StatProps) {
  return <div className="stat" title={title}>{children}</div>;
}
