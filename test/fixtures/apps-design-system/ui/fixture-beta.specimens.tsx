import type { Specimen } from '../../views/design-system/specimen';
import FixtureBeta from './fixture-beta';

export const specimens: Specimen[] = [
  { title: 'Plain', render: () => <FixtureBeta text="Three tickets are ready." /> },
  { title: 'Muted', render: () => <FixtureBeta text="Nothing waits on you." tone="muted" /> },
];
