import type { Specimen } from '../../views/design-system/specimen';
import TextArea from './text-area';

export const specimens: Specimen[] = [
  { title: 'Default', render: (on) => <TextArea data={{ q: 'q-1' }} placeholder="Add a note (optional)" onChange={on('change')} /> },
  { title: 'With a draft', render: (on) => <TextArea data={{ q: 'q-1' }} placeholder="Add a note (optional)" defaultValue="Ship it on Friday, after the release." onChange={on('change')} /> },
  { title: 'Rows and a limit', render: (on) => <TextArea data={{ 'know-note': 'k-1' }} rows={1} maxLength={600} placeholder="Add a note to refine it (optional): it goes with the lesson into every prompt" onChange={on('change')} /> },
  { title: 'With an id', render: (on) => <TextArea id="tl-c-text" rows={2} placeholder="Message" onChange={on('change')} /> },
];
