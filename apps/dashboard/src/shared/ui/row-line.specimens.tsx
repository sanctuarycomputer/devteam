import type { Specimen } from '../../views/design-system/specimen';
import Dot from './dot';
import RowLine from './row-line';

export const specimens: Specimen[] = [
  { title: 'Default', render: () => <RowLine><Dot tone="amber" /><span className="t" title="Retried 3 times">Retried 3 times</span><span className="r">retries</span></RowLine> },
  { title: 'Opens a record', render: (on) => <RowLine data={{ open: 'observation/o-1' }} tabIndex={0} role="link" onClick={on('open')}><Dot tone="red" /><span className="t">Disk at 91%</span><span className="r">Nov 27</span></RowLine> },
  { title: 'With its own class', note: 'a setting\'s row', render: () => <RowLine className="set-row" data={{ setting: 'workers' }}><span className="t"><span className="set-name">Workers</span> <code className="set-key">workers</code></span></RowLine> },
];
