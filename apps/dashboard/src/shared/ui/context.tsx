// A question's context (layout.css: .ctx): the paragraphs the view writes from its text.
import type { ReactNode } from 'react';

export type ContextProps = {
  children?: ReactNode;
};

export default function Context({ children }: ContextProps) {
  return <div className="ctx">{children}</div>;
}
