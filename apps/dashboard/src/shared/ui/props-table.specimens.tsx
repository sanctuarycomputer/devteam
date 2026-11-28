import type { Specimen } from '../../views/design-system/specimen';
import PropsTable from './props-table';

export const specimens: Specimen[] = [
  { title: 'Default', render: () => <PropsTable rows={[['Ticket', 'kit-1041'], ['Phase', 'spec']]} /> },
  { title: 'With tips', render: () => <PropsTable rows={[['Risk', 'normal', 'How likely the change breaks something'], ['Size', 'M']]} /> },
  { title: 'An empty value', render: () => <PropsTable rows={[['Owner', null]]} /> },
  { title: 'No rows', render: () => <PropsTable rows={[]} /> },
];
