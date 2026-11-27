// A row of inline controls (shell.css css-common: .row-inline, its text input and buttons): a field and its
// buttons side by side, wrapping.
import type { ReactNode } from 'react';

export type RowInlineProps = {
  children?: ReactNode;
};

export default function RowInline({ children }: RowInlineProps) {
  return <div className="row-inline">{children}</div>;
}
