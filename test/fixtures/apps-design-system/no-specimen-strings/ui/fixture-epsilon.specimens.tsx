import type { Specimen } from '../../views/design-system/specimen';

const base = {} as Specimen;
// { title: 'Commented', render: () => null }
const help = "each is { title: string, render(on) }";
export const specimens: Specimen[] = [{ ...base }];
export { help };
