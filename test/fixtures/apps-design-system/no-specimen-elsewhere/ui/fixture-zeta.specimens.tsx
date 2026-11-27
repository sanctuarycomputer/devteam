import type { Specimen } from '../../views/design-system/specimen';
import FixtureZeta from './fixture-zeta';

const example: Specimen = { title: 'Not listed', render: () => <FixtureZeta /> };
export const specimens: Specimen[] = [];
export { example };
