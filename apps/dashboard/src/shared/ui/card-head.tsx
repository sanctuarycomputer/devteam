// A card's title bar, as cardHead writes it (layout.css: .card-head, .grow, .end): lead (a goal's drag
// handle), the icon, the label, span.grow holding extra, then end and the card's ⋯ menu (a CardMenu).
// A head whose title is in the grow (today's static cards) passes it as extra and no label; a peek
// section's head has no icon.
import type { ReactNode } from 'react';

export type CardHeadProps = {
  icon?: string;
  label?: ReactNode;
  extra?: ReactNode;
  growId?: string;
  lead?: ReactNode;
  end?: ReactNode;
  menu?: ReactNode;
};

export default function CardHead({ icon, label, extra, growId, lead, end, menu }: CardHeadProps) {
  return (
    <div className="card-head">
      {lead}
      {icon ? <i className={`icon-${icon}`} aria-hidden="true"></i> : null}
      {label}
      <span className="grow" id={growId}>{extra}</span>
      {end}
      {menu}
    </div>
  );
}
