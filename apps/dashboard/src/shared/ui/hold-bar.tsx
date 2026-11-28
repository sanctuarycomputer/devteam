// A bar of a record's controls (shell.css css-misc: .holdbar): a goal's hold switch, or its Mark met button,
// with the hint and the error line beside them, wrapping.
import type { ReactNode } from 'react';

export type HoldBarProps = {
  children?: ReactNode;
};

export default function HoldBar({ children }: HoldBarProps) {
  return <div className="holdbar">{children}</div>;
}
