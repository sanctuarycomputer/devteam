import type { Specimen } from '../../views/design-system/specimen';
import Dot from './dot';
import RowLine from './row-line';
import Rows from './rows';

export const specimens: Specimen[] = [
  { title: 'Default', render: () => <Rows><RowLine><Dot tone="green" /><span className="t">Nothing waiting</span></RowLine></Rows> },
  { title: 'With its own class', render: () => <Rows className="sensor-rows"><RowLine><Dot tone="blue" /><span className="t">Load is normal</span></RowLine></Rows> },
];
