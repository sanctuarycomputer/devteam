// A loading state, as today's markup writes it (shell.css css-base: .loading): what is on its way, until it
// comes; beside empty, which says nothing is there.
import type { ReactNode } from 'react';

export type LoadingProps = {
  id?: string;
  children?: ReactNode;
};

export default function Loading({ id, children }: LoadingProps) {
  return <p className="loading" id={id}>{children}</p>;
}
