import type { Specimen } from '../../views/design-system/specimen';
import Badge from './badge';

export const specimens: Specimen[] = [
  { title: 'Default', render: () => <Badge id="av-kind">Mock</Badge> },
  { title: 'Good', render: () => <Badge tone="good" title="Enough answers went with its recommendation to ask you to raise it">ready to ask for more</Badge> },
  { title: 'Low', render: () => <Badge tone="low">now</Badge> },
  { title: 'High', render: () => <Badge tone="high">flaky</Badge> },
  { title: 'Medium', render: () => <Badge tone="medium">often fails</Badge> },
  { title: 'Critical', render: () => <Badge tone="critical">critical</Badge> },
  { title: 'Hidden, with its own class', note: 'the kit release badge, hidden until the release is known', render: () => <Badge className="kit" id="kit" hidden /> },
];
