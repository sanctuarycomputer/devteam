// A list of rows (layout.css: .rows): row lines one under another.
import type { ReactNode } from 'react';

export type RowsProps = {
  className?: string;
  children?: ReactNode;
};

export default function Rows({ className, children }: RowsProps) {
  return <div className={['rows', className ?? ''].filter(Boolean).join(' ')}>{children}</div>;
}
