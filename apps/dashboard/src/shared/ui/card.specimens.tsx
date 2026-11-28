import type { Specimen } from '../../views/design-system/specimen';
import Badge from './badge';
import Card from './card';
import CardHead from './card-head';

export const specimens: Specimen[] = [
  { title: 'Default', render: () => <Card><CardHead icon="book-open" extra="Stories" /><div id="w-stories"></div></Card> },
  { title: 'Flush', render: () => <Card flush><CardHead icon="eye" label="Observations" growId="c-observe" /><div id="observations"></div></Card> },
  { title: 'Small', render: () => <Card small><Badge tone="high">sev 3</Badge> <a className="linkish" href="#problem/p-7">Disk fills up</a> <span className="muted">· open · a risk</span></Card> },
  { title: 'Opens a record', note: 'a grid span and a view class come in className', render: (on) => <Card className="c6 sensor-card" data={{ open: 'sensor/disk' }} tabIndex={0} role="button" label="Open the sensor disk" onClick={on('open')}><CardHead icon="activity" label="disk" extra={<Badge tone="good">ok</Badge>} /><div className="sensor-src">every 5 minutes</div></Card> },
];
