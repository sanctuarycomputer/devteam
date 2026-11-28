import type { Specimen } from '../../views/design-system/specimen';
import Button from './button';
import CardMenu from './card-menu';

export const specimens: Specimen[] = [
  { title: 'Default', render: (on) => <CardMenu recordId="t-20261127-1" onCopy={on('copy')} /> },
  { title: 'Rows and a peek', render: (on) => <CardMenu recordId="g-12" rows={[['Created', 'Nov 2'], ['By', 'owner']]} open="goal/g-12" onCopy={on('copy')} onOpen={on('open')} /> },
  { title: 'A record card', note: 'cardMenu: the peek is <kind>/<id>', render: (on) => <CardMenu recordId="kit-1041" rows={[['Phase', 'build']]} open="ticket/kit-1041" onCopy={on('copy')} onOpen={on('open')} /> },
  { title: 'Extra actions', render: (on) => <CardMenu rows={[['Moved', 'by the owner']]} extra={<Button type="button" kind="ghost" data={{ move: 'up' }} onClick={on('move up')}>Move up</Button>} /> },
];
