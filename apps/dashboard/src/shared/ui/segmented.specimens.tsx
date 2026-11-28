import type { Specimen } from '../../views/design-system/specimen';
import Button from './button';
import Segmented from './segmented';

export const specimens: Specimen[] = [
  {
    title: 'Default',
    render: (on) => (
      <Segmented label="Which threads">
        <Button type="button" data={{ thf: 'open' }} pressed onClick={on('open')}>Open <span className="n">3</span></Button>
        <Button type="button" data={{ thf: 'resolved' }} pressed={false} onClick={on('resolved')}>Resolved <span className="n">12</span></Button>
      </Segmented>
    ),
  },
  {
    title: 'Compact',
    render: (on) => (
      <Segmented label="View" compact>
        <Button type="button" data={{ mdview: 'rendered' }} pressed onClick={on('rendered')}>Rendered</Button>
        <Button type="button" data={{ mdview: 'raw' }} pressed={false} onClick={on('raw')}>Raw</Button>
      </Segmented>
    ),
  },
  { title: 'One button', render: (on) => <Segmented label="Hold" compact><Button type="button" data={{ 'hold-id': 'g-12', mode: 'restore' }} onClick={on('restore')}>Restore (parked)</Button></Segmented> },
];
