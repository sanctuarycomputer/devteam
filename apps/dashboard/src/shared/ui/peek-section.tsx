// A section of a peek, as psect writes it (shell.css css-misc: .psect, .psect-body; layout.css: .card,
// .card-head, .grow): a card with its title in the head's grow, then its body.
import type { ReactNode } from 'react';
import Card from './card';
import CardHead from './card-head';

export type PeekSectionProps = {
  title: ReactNode;
  data?: Record<string, string>;
  children?: ReactNode;
};

export default function PeekSection({ title, data, children }: PeekSectionProps) {
  return (
    <Card className="psect" data={data}>
      <CardHead extra={title} />
      <div className="psect-body">{children}</div>
    </Card>
  );
}
