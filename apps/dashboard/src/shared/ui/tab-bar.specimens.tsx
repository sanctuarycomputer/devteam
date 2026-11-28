import type { Specimen } from '../../views/design-system/specimen';
import TabBar from './tab-bar';

export const specimens: Specimen[] = [
  { title: 'Default', render: (on) => <TabBar tabs={[{ id: 'open', label: 'Open', count: 3 }, { id: 'resolved', label: 'Resolved', count: 12 }]} selected="open" panel="th-list" onSelect={on('select')} /> },
  { title: 'A count waiting', render: (on) => <TabBar tabs={[{ id: 'inbox', label: 'Inbox', count: 2, waiting: true }, { id: 'all', label: 'All' }]} selected="all" onSelect={on('select')} /> },
  { title: 'A disabled tab', note: 'the disabled tab asked for, the first enabled one selected', render: (on) => <TabBar tabs={[{ id: 'active', label: 'Active' }, { id: 'blocked', label: 'Blocked', disabled: true }]} selected="blocked" onSelect={on('select')} /> },
  { title: 'Sub', render: (on) => <TabBar tabs={[{ id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }]} selected="week" size="sub" onSelect={on('select')} /> },
  { title: 'No tabs', render: () => <TabBar tabs={[]} /> },
];
