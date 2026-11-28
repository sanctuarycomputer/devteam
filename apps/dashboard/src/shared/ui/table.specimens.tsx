import type { Specimen } from '../../views/design-system/specimen';
import GateDot from './gate-dot';
import Table from './table';

export const specimens: Specimen[] = [
  {
    title: 'Numbers',
    render: () => (
      <Table kind="nums" head={['', 'This retro', 'The one before']}>
        <tr><td>Tickets merged</td><td>12</td><td>9</td></tr>
        <tr><td>Hours</td><td>31</td><td>40</td></tr>
      </Table>
    ),
  },
  {
    title: 'Gate runs',
    render: () => (
      <Table kind="gates-table" head={['Commit', 'test', 'lint']}>
        <tr><td><code>a1f984fc0fc5</code></td><td title="test at a1f984fc0fc5: passed, 41.2s"><GateDot state="ok" /></td><td className="muted">–</td></tr>
      </Table>
    ),
  },
  {
    title: 'With a data attribute',
    render: () => (
      <Table kind="nums" data={{ 'learning-figures': '' }} head={['', 'Figure', 'Count', 'What it counted']}>
        <tr><td>1</td><td>Lessons kept</td><td>14</td><td>lessons an agent read and followed</td></tr>
      </Table>
    ),
  },
];
