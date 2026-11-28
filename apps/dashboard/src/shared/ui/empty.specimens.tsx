import type { Specimen } from '../../views/design-system/specimen';
import Empty from './empty';

export const specimens: Specimen[] = [
  { title: 'Default', render: () => <Empty>None</Empty> },
  { title: 'With code', render: () => <Empty>No sensors yet: add one with <code>devteam sensor add</code>.</Empty> },
  { title: 'Long text', render: () => <Empty>Nothing has been learned yet. Lessons appear here once the supervisor turns repeated observations into a rule the next sessions read, and you accept it.</Empty> },
];
