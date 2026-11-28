// A timeline (shell.css css-misc: .tl, its li, time and the li's kind: q, act, msg, gate): an ordered list,
// each item a <li> the view writes, with its <time> first.
import type { ReactNode } from 'react';

export type TimelineProps = {
  children?: ReactNode;
};

export default function Timeline({ children }: TimelineProps) {
  return <ol className="tl">{children}</ol>;
}
