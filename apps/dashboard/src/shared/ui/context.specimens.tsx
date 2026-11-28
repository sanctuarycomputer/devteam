import type { Specimen } from '../../views/design-system/specimen';
import Context from './context';

export const specimens: Specimen[] = [
  { title: 'Default', render: () => <Context><p>Asked after the v0.106 release failed its smoke test.</p></Context> },
];
