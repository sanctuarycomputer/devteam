'use client';
// kit-1006: terminal's client code. Its top level runs once when its chunk loads in the browser and registers
// terminal's COMPAT globals (termPaint, termTab), each the binding terminal's modules use, and TERM, which
// dashboard-terminal-tabs reads in the page though COMPAT's scan missed it: a value, so a getter over term.ts's own
// object (APPS.md, The compatibility surface), defined only where a window exists. TerminalClient renders nothing;
// its one effect runs bootTerminal() once, behind this module's flag, so a remount (development's double effect) adds
// no second listener and asks for no second token.
import { useEffect } from 'react';
import { expose } from '../../shared/compat';
import { bootTerminal } from './boot';
import { TERM, termPaint, termTab } from './term';

expose('termPaint', termPaint);
expose('termTab', termTab);
if (typeof window !== 'undefined') Object.defineProperty(window, 'TERM', { get: () => TERM, configurable: false });

let booted = false; // bootTerminal() has run

export default function TerminalClient(): null {
  useEffect(() => {
    if (booted) return;
    booted = true;
    bootTerminal();
  }, []);
  return null;
}
