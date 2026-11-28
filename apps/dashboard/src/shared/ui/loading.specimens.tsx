import type { Specimen } from '../../views/design-system/specimen';
import Loading from './loading';

export const specimens: Specimen[] = [
  { title: 'Default', render: () => <Loading>Loading…</Loading> },
  { title: 'With its id', render: () => <Loading id="loading">Loading…</Loading> },
  { title: 'Other words', render: () => <Loading>Loading the review…</Loading> },
];
