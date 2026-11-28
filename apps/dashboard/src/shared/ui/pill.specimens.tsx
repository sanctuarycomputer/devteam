import type { Specimen } from '../../views/design-system/specimen';
import Pill from './pill';

export const specimens: Specimen[] = [
  { title: 'Building', render: () => <Pill tone="green">Building</Pill> },
  { title: 'Moving', render: () => <Pill tone="blue">Moving</Pill> },
  { title: 'Waiting on you', render: () => <Pill tone="amber">Waiting on you</Pill> },
  { title: 'Fully blocked', render: () => <Pill tone="red">Fully blocked</Pill> },
  { title: 'Idle', render: () => <Pill>Idle</Pill> },
  { title: "A card's pill, with a title", note: 'a ticket card\'s pills (board, autonomy)', render: () => <Pill badge tone="medium" title="Waiting on the owner since Nov 26">waiting</Pill> },
  { title: "A card's pill, with an icon", render: () => <Pill badge tone="good" icon="check" title="Verified on Nov 27">verified</Pill> },
  { title: "A card's pill, no tone", render: () => <Pill badge>merged, not yet verified</Pill> },
  { title: "A card's pill, regressed", render: () => <Pill badge tone="high">regressed</Pill> },
];
