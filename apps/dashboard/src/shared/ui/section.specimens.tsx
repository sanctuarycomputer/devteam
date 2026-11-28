import type { Specimen } from '../../views/design-system/specimen';
import Empty from './empty';
import RowLine from './row-line';
import Rows from './rows';
import Section from './section';

export const specimens: Specimen[] = [
  { title: 'Default', render: () => <Section label="Score"><div className="sec-b"><Empty>None</Empty></div></Section> },
  { title: 'A group', note: 'a settings group: a div, its rows the body', render: () => <Section as="div" label="Workers"><Rows><RowLine><span className="t">Limit</span></RowLine></Rows></Section> },
];
