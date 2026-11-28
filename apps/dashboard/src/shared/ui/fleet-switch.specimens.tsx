import type { Specimen } from '../../views/design-system/specimen';
import FleetSwitch from './fleet-switch';

export const specimens: Specimen[] = [
  { title: 'Run', render: (on) => <FleetSwitch scope="project" mode="run" onPress={on('press')} /> },
  { title: 'Drain', render: (on) => <FleetSwitch scope="project" mode="drain" onPress={on('press')} /> },
  { title: 'Park, confirming', render: (on) => <FleetSwitch scope="project" mode="run" confirming onPress={on('press')} /> },
  { title: 'Machine, mixed', render: (on) => <FleetSwitch scope="machine" mode="mixed" counts={{ running: 2, draining: 1, parked: 1 }} confirming onPress={on('press')} /> },
  { title: 'A hub row', render: (on) => <FleetSwitch scope="row" mode="park" onPress={on('press')} /> },
  { title: 'Busy', render: (on) => <FleetSwitch scope="project" mode="drain" busy="Draining…" onPress={on('press')} /> },
  { title: 'Error', render: (on) => <FleetSwitch scope="project" mode="run" error="The kit refused: not the host" onPress={on('press')} /> },
];
