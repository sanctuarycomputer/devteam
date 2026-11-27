// apps-src@2 (APPS.md, Shared code): a component's specimens, in src/shared/ui/<name>.specimens.tsx:
//   export const specimens: Specimen[] = [{ title: 'Default', render: (on) => <Button onClick={on('click')} /> }];
// One per state worth seeing (default, empty, long text, disabled, error, each variant). `on(event)` is the
// only handler a specimen passes its component: it appends "<event>" to the page's event list, and does
// nothing else.
import type { ReactNode } from 'react';

export type On = (event: string) => (...args: unknown[]) => void;

export type Specimen = { title: string; note?: string; render: (on: On) => ReactNode };
