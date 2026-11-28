import type { Specimen } from '../../views/design-system/specimen';
import Button from './button';
import RowInline from './row-inline';
import TextField from './text-field';

export const specimens: Specimen[] = [
  {
    title: 'Default',
    render: (on) => (
      <RowInline>
        <TextField data={{ overrule: 'q-1' }} placeholder="Your answer instead" onChange={on('change')} />
        <Button kind="ghost" data={{ 'overrule-send': 'q-1' }} onClick={on('overrule')}>Overrule</Button>
        <span className="err" id="e-q-1"></span>
      </RowInline>
    ),
  },
];
