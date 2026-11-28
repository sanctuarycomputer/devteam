import type { Specimen } from '../../views/design-system/specimen';
import Select from './select';

export const specimens: Specimen[] = [
  { title: 'Default', render: (on) => <Select data={{ f: 'kind' }} label="Kind" options={[{ value: '', label: 'Any kind' }, { value: 'bug', label: 'Bug' }, { value: 'feature', label: 'Feature' }]} onChange={on('change')} /> },
  {
    title: 'A chosen option',
    render: (on) => (
      <Select data={{ impact: 'k-1' }} label="What it is" defaultValue="2" onChange={on('change')} options={[
        { value: '4', label: '4: it changed the outcome' }, { value: '3', label: '3: it saved real time' }, { value: '2', label: '2: it helped a little' }, { value: '1', label: '1: no effect' },
      ]} />
    ),
  },
];
