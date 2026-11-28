// A record's title as a link (shell.css css-common, css-chrome: .card a.title-link): to its peek or page.
import type { ReactNode } from 'react';

export type TitleLinkProps = {
  href: string;
  children?: ReactNode;
};

export default function TitleLink({ href, children }: TitleLinkProps) {
  return <a className="title-link" href={href}>{children}</a>;
}
