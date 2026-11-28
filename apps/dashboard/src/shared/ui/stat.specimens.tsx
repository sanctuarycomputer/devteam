import type { Specimen } from '../../views/design-system/specimen';
import Stat from './stat';

export const specimens: Specimen[] = [
  { title: 'Default', render: () => <Stat><span>calls since Nov 2</span><b>14</b></Stat> },
  { title: 'With a line under it', render: () => <Stat title="What a point of work cost"><span className="k">Cost</span><b>$4.10</b><span className="dim">per point</span></Stat> },
];
