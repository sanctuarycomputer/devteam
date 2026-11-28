import type { Specimen } from '../../views/design-system/specimen';
import TitleLink from './title-link';

export const specimens: Specimen[] = [
  { title: 'Default', render: () => <TitleLink href="#goal/upkeep">Upkeep</TitleLink> },
  { title: 'A bold title', render: () => <TitleLink href="#ticket/kit-1041"><b>The first shared components</b></TitleLink> },
];
