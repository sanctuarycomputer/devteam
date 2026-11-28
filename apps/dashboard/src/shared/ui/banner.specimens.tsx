import type { Specimen } from '../../views/design-system/specimen';
import Banner from './banner';
import Button from './button';

export const specimens: Specimen[] = [
  { title: 'Default', render: () => <Banner><b>The page or data changed since the supervisor asked.</b> Nothing can be answered here. Tell the supervisor to ask again.</Banner> },
  { title: 'Alert', note: 'hidden until a failure fills it', render: () => <Banner id="banner" role="alert">The kit refused the last change: this machine is not the host.</Banner> },
  { title: 'Updated', note: 'hidden until the page changes under the tab', render: (on) => <Banner tone="updated" id="updated" role="status">The dashboard was updated since this tab opened, so some of what you see may be out of date.{' '}<Button id="reload-page" onClick={on('reload')}>Reload</Button></Banner> },
  { title: 'Stale, with its own class', render: () => <Banner tone="stale" className="rv-link" id="rv-link" role="alert">The review page moved on since this question was asked.</Banner> },
];
