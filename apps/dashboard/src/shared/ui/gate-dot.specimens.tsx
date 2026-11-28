import type { Specimen } from '../../views/design-system/specimen';
import GateDot from './gate-dot';

export const specimens: Specimen[] = [
  { title: 'Passed', render: () => <GateDot state="ok" /> },
  { title: 'Failed', render: () => <GateDot state="fail" /> },
  { title: 'Flaky', render: () => <GateDot state="flaky" /> },
];
