import type { Specimen } from '../../views/design-system/specimen';
import Badge from './badge';
import Button from './button';
import CardHead from './card-head';
import CardMenu from './card-menu';

export const specimens: Specimen[] = [
  { title: 'Default', render: () => <CardHead icon="target" label="Ship the hub" /> },
  { title: 'With extra', render: () => <CardHead icon="activity" label="disk" extra={<Badge tone="good">ok</Badge>} /> },
  { title: 'With its menu', render: (on) => <CardHead icon="flag" label="Ship the hub" menu={<CardMenu recordId="g-12" open="goal/g-12" onCopy={on('copy')} onOpen={on('open')} />} /> },
  { title: 'With a lead', note: 'a goal\'s drag handle', render: (on) => <CardHead icon="target" label="Ship the hub" lead={<Button type="button" className="goal-grip" data={{ 'goal-grip': 'g-12' }} label="Reorder Ship the hub" title="Drag to reorder; or ↑ and ↓" onClick={on('grip')}><i className="icon-grip-vertical" aria-hidden="true"></i></Button>} /> },
  { title: 'Title in the grow', render: () => <CardHead icon="chart-line" extra="Burn-up" end={<span className="end" id="forecast"></span>} /> },
  { title: 'A grow with its id', render: () => <CardHead icon="eye" label="Observations" growId="c-observe" /> },
];
