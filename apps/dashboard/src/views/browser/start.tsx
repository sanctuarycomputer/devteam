'use client';
// Runs the page's script once, after hydration: the markup is the server's, and React never renders it again.
import { useEffect } from 'react';
import { start } from './view';

export default function Start() {
  useEffect(() => { start(); }, []);
  return null;
}
