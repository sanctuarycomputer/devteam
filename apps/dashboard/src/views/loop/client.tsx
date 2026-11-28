'use client';
// kit-996: loop's client code. Its top level runs once when its chunk loads in the browser and registers loop's one
// COMPAT global, matchedWords (ooda's binding). expose() registers nothing on the server. LoopClient renders nothing;
// its one effect runs bootLoop() (index.html's two listeners for Correct, on #loop and #drawer) once, behind this
// module's flag, so a remount (development's double effect) adds no second listener. The draw is data's render's.
import { useEffect } from 'react';
import { expose } from '../../shared/compat';
import './wire';
import { matchedWords } from './ooda';
import { bootLoop } from './tables';

expose('matchedWords', matchedWords);

let booted = false; // bootLoop() has run

export default function LoopClient(): null {
  useEffect(() => {
    if (booted) return;
    booted = true;
    bootLoop();
  }, []);
  return null;
}
