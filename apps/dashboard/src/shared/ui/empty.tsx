// An empty state, as empty() writes it (shell.css css-base: .empty): what would fill it, so an empty
// section reads as "nothing yet", not "broken".
import type { ReactNode } from 'react';

export type EmptyProps = {
  children?: ReactNode;
};

export default function Empty({ children }: EmptyProps) {
  return <p className="empty">{children}</p>;
}
