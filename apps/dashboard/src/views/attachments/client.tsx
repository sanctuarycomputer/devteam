'use client';
// kit-1001: attachments' client code. Its top level runs once when its chunk loads in the browser and registers
// attachments' 2 COMPAT globals (drawPills, qcardOf) and ATTACH, which test/dashboard-measure.test.mjs sets in the
// page (COMPAT's scan missed it): a value, so a getter and a setter over the module's Map, as APPS.md's compatibility
// surface says. index.html's ATTACH is a const, so the setter throws what an assignment to it throws there. expose() registers nothing on the server, and the property
// is defined only where a window exists. AttachmentsClient renders nothing; its one effect runs bootAttachments()
// once, behind this module's flag, so a remount (development's double effect) adds no second listener.
import { useEffect } from 'react';
import { expose } from '../../shared/compat';
import { qcardOf } from './answers';
import { bootAttachments } from './boot';
import { ATTACH, drawPills } from './pills';

expose('drawPills', drawPills);
expose('qcardOf', qcardOf);
if (typeof window !== 'undefined') Object.defineProperty(window, 'ATTACH', { get: () => ATTACH, set: () => { throw new TypeError('Assignment to constant variable.'); }, configurable: false });

let booted = false; // bootAttachments() has run

export default function AttachmentsClient(): null {
  useEffect(() => {
    if (booted) return;
    booted = true;
    bootAttachments();
  }, []);
  return null;
}
