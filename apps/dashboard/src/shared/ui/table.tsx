// A plain table in its scroll box (shell.css css-common: .scroll, table, th, td; css-misc: .nums,
// .gates-table): its head row of th, then the rows the view writes (a tr each, its cells as the view has
// them). Today's markup puts the rows straight in the table and the HTML parser wraps them all in one
// tbody; this writes that tbody, so the DOM is the same.
import type { ReactNode } from 'react';

export type TableProps = {
  kind: 'nums' | 'gates-table';
  head: ReactNode[];
  data?: Record<string, string>;
  children?: ReactNode;
};

export default function Table({ kind, head, data, children }: TableProps) {
  const dataAttrs = Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]));
  return (
    <div className="scroll">
      <table className={kind} {...dataAttrs}>
        <tbody>
          <tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr>
          {children}
        </tbody>
      </table>
    </div>
  );
}
