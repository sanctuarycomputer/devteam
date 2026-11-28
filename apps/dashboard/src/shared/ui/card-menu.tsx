// A card's ⋯ menu, as menuOf writes it (shell.css css-chrome: details.menu, .pop, .pop .kv): its ID and
// rows, Copy ID (data-copy), Open in side peek (data-menu-open, '<kind>/<id>'), then extra (a goal's Move
// up and Move down). The document-wide handler acts on the data attributes, as today.
import { Fragment, type MouseEventHandler, type ReactNode } from 'react';
import Button from './button';

export type CardMenuProps = {
  recordId?: string | null;
  rows?: [string, ReactNode][];
  open?: string | null;
  extra?: ReactNode;
  onCopy?: MouseEventHandler<HTMLButtonElement>;
  onOpen?: MouseEventHandler<HTMLButtonElement>;
};

export default function CardMenu({ recordId = null, rows = [], open = null, extra, onCopy, onOpen }: CardMenuProps) {
  return (
    <details className="menu">
      <summary aria-label="Details"><i className="icon-ellipsis" aria-hidden="true"></i></summary>
      <div className="pop">
        <div className="kv">
          {recordId ? <><span>ID</span><code>{recordId}</code></> : null}
          {rows.map(([k, v], i) => <Fragment key={i}><span>{k}</span><span>{v}</span></Fragment>)}
        </div>
        {recordId ? <Button kind="ghost" data={{ copy: recordId }} onClick={onCopy}>Copy ID</Button> : null}
        {open ? <Button type="button" kind="ghost" data={{ 'menu-open': open }} onClick={onOpen}>Open in side peek</Button> : null}
        {extra}
      </div>
    </details>
  );
}
