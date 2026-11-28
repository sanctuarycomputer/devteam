import type { Specimen } from '../../views/design-system/specimen';
import Dot from './dot';

export const specimens: Specimen[] = [
  { title: 'Default', render: () => <Dot /> },
  { title: 'Green', render: () => <Dot tone="green" /> },
  { title: 'Amber', render: () => <Dot tone="amber" /> },
  { title: 'Red', render: () => <Dot tone="red" /> },
  { title: 'Blue', render: () => <Dot tone="blue" /> },
];
