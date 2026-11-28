// A labelled section of a page (layout.css: .sec, .sec .lbl): its label, then its body, as the view writes
// it (a div.sec-b, or rows). A section element, or a div as the settings groups are.
import type { ReactNode } from 'react';

export type SectionProps = {
  label: ReactNode;
  as?: 'section' | 'div';
  children?: ReactNode;
};

export default function Section({ label, as = 'section', children }: SectionProps) {
  const Tag = as;
  return (
    <Tag className="sec">
      <div className="lbl">{label}</div>
      {children}
    </Tag>
  );
}
