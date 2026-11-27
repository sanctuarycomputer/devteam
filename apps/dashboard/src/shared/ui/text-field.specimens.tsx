import type { Specimen } from '../../views/design-system/specimen';
import TextField from './text-field';

export const specimens: Specimen[] = [
  { title: 'Default', render: (on) => <TextField data={{ overrule: 'q-1' }} placeholder="Your answer instead" onChange={on('change')} /> },
  { title: 'With an id and a limit', render: (on) => <TextField id="tl-outcome" maxLength={300} placeholder="How it ended, in a line (optional)" onChange={on('change')} /> },
];
