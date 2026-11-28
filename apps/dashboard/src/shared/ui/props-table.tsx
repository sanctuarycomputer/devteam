// The properties table, as props() writes it (layout.css: .props): per row a dt (with its tip as title,
// focusable, when it has one) and a dd.
import { Fragment, type ReactNode } from 'react';

export type PropsTableProps = {
  rows: [string, ReactNode, string?][];
};

export default function PropsTable({ rows }: PropsTableProps) {
  return (
    <dl className="props">
      {rows.map(([k, v, tip], i) => (
        <Fragment key={i}>
          <dt title={tip ? tip : undefined} tabIndex={tip ? 0 : undefined}>{k}</dt>
          <dd>{v ?? ''}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
