import type { Specimen } from '../../views/design-system/specimen';
import FixtureAlpha from './fixture-alpha';

export const specimens: Specimen[] = [
  { title: 'Default', render: (on) => <FixtureAlpha label="Press me" onPress={on('press')} /> },
  { title: 'Disabled', note: 'a press does nothing', render: (on) => <FixtureAlpha label="Not now" onPress={on('press')} disabled /> },
  { title: 'Long label', render: (on) => <FixtureAlpha label="A label long enough to wrap on a narrow screen, so its line height shows" onPress={on('press')} /> },
];
