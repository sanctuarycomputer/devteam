import type { Specimen } from '../../views/design-system/specimen';
import Button from './button';

export const specimens: Specimen[] = [
  { title: 'Solid', render: (on) => <Button data={{ 'post-secrets': 'q-1' }} onClick={on('click')}>Post</Button> },
  { title: 'Ghost', render: (on) => <Button kind="ghost" data={{ 'dismiss-refused': 'q-1' }} onClick={on('click')}>Dismiss</Button> },
  { title: 'Icon', render: (on) => <Button kind="ghost" icon id="drawer-close" label="Close" onClick={on('click')}><i className="icon-x" aria-hidden="true"></i></Button> },
  { title: 'Icon, pressed state and title', render: (on) => <Button type="button" kind="ghost" icon id="tl-pinbtn" pressed={false} label="Pin" title="Point at something to start a thread: for a phone, or for a long look around" onClick={on('click')}><i className="icon-map-pin" aria-hidden="true"></i></Button> },
  { title: 'Pressed', render: (on) => <Button type="button" pressed data={{ 'limit-none': 'workers' }} onClick={on('click')}>No limit</Button> },
  { title: 'Disabled', render: (on) => <Button type="button" pressed={false} data={{ 'limit-none': 'workers' }} disabled onClick={on('click')}>No limit</Button> },
  { title: 'A static tab', note: 'the loop view\'s own tab buttons', render: (on) => <Button type="button" role="tab" data={{ tab: 'observe' }} onClick={on('click')}>Observe<span className="n" id="n-observe"></span></Button> },
  { title: 'Hidden, with its own class', note: 'hidden until the limit changes', render: (on) => <Button type="button" className="mini" data={{ 'limit-save': 'workers' }} hidden onClick={on('click')}>Save</Button> },
  { title: 'Out of the tab order', note: 'shown when new data comes', render: (on) => <Button className="held" id="held" type="button" tabIndex={-1} onClick={on('click')}>New data. Click to refresh</Button> },
];
