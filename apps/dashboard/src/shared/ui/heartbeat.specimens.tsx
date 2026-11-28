import type { Specimen } from '../../views/design-system/specimen';
import Heartbeat from './heartbeat';

export const specimens: Specimen[] = [
  {
    title: 'Two weeks',
    render: () => (
      <Heartbeat days={[
        { day: '2026-11-14' }, { day: '2026-11-15', items: ['metrics'] }, { day: '2026-11-16', items: ['metrics', 'lessons'] }, { day: '2026-11-17' },
        { day: '2026-11-18', items: ['a', 'b', 'c'] }, { day: '2026-11-19', items: ['a', 'b', 'c', 'd', 'e'] }, { day: '2026-11-20', failed: true, items: ['metrics'] },
        { day: '2026-11-21' }, { day: '2026-11-22', items: ['metrics'] }, { day: '2026-11-23' }, { day: '2026-11-24', items: ['release'] }, { day: '2026-11-25' },
        { day: '2026-11-26', items: ['metrics', 'lessons'] }, { day: '2026-11-27', items: ['metrics'] },
      ]} />
    ),
  },
  { title: 'A failed day', render: () => <Heartbeat days={[{ day: '2026-11-26' }, { day: '2026-11-27', failed: true }]} /> },
  { title: 'No days', render: () => <Heartbeat days={[]} /> },
];
