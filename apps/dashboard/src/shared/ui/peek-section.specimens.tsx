import type { Specimen } from '../../views/design-system/specimen';
import Dot from './dot';
import Empty from './empty';
import PeekSection from './peek-section';
import RowLine from './row-line';
import Rows from './rows';

export const specimens: Specimen[] = [
  { title: 'Default', render: () => <PeekSection title="Observations it made"><Empty>None</Empty></PeekSection> },
  {
    title: 'With rows',
    render: (on) => (
      <PeekSection title="Incidents">
        <Rows className="sensor-rows">
          <RowLine data={{ open: 'problem/p-7' }} tabIndex={0} role="link" onClick={on('open')}><Dot tone="amber" /><span className="t">Disk fills up</span><span className="r">Nov 27</span></RowLine>
        </Rows>
      </PeekSection>
    ),
  },
];
