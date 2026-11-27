'use client';
// The canvas's one client component (kit-1013): it renders nothing and, once hydrated, runs mount().
// It never re-renders: it has no state or props, and the view above it has none either.
import { useEffect } from 'react';
import { mount } from './mount';

export default function Mount() {
  useEffect(() => {
    mount();
  }, []);
  return null;
}
