'use client';
// kit-999: review's client code (spec, The view). Its top level runs once when its chunk loads in the browser and
// registers review's one COMPAT global, holdState, the lib's own function; expose() registers nothing on the server.
// index.html adds three window listeners at load (4126-4137): the review frame's message bridge, the colour-scheme
// change that re-themes the frame, and pagehide, which pushes a pending draft. Here one effect adds them, once per
// page load (APPS.md: a module starts no work at load), each with index.html's target, event and `?.`; none is
// removed, as index.html never removes them. A frame exists only after openReview, which data calls after its own
// effect's first load, so no message comes before the listener (spec S21). ReviewClient renders nothing.
import { useEffect } from 'react';
import { expose } from '../../shared/compat';
import { bridgeMessage } from '../../lib/review-bridge';
import { holdState, pageHide, themeChange } from '../../lib/review-page';
import './wire';

expose('holdState', holdState);

let listening = false; // the three listeners are added

export default function ReviewClient(): null {
  useEffect(() => {
    if (listening) return;
    listening = true;
    window.addEventListener('message', bridgeMessage);
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', themeChange);
    window.addEventListener('pagehide', pageHide);
  }, []);
  return null;
}
