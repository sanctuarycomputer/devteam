import type { Specimen } from '../../views/design-system/specimen';
import Button from './button';
import HoldBar from './hold-bar';
import Segmented from './segmented';

export const specimens: Specimen[] = [
  {
    title: 'Hold',
    render: (on) => (
      <HoldBar>
        <Segmented compact label="Hold">
          <Button type="button" data={{ 'hold-id': 'g-1', mode: 'run' }} pressed onClick={on('run')}>Run</Button>
          <Button type="button" data={{ 'hold-id': 'g-1', mode: 'drain' }} pressed={false} onClick={on('drain')}>Drain</Button>
          <Button type="button" data={{ 'hold-id': 'g-1', mode: 'park' }} pressed={false} onClick={on('park')}>Park</Button>
        </Segmented>
        <span className="err" id="e-hold-g-1"></span>
      </HoldBar>
    ),
  },
  {
    title: 'Restoring',
    render: () => (
      <HoldBar>
        <span className="muted small">Restoring: it comes back parked…</span>
        <span className="err" id="e-hold-g-1"></span>
      </HoldBar>
    ),
  },
  {
    title: 'Mark met',
    render: (on) => (
      <HoldBar>
        <Button type="button" data={{ 'met-id': 'g-1' }} onClick={on('met')}>Mark met</Button>
        <span className="muted small">your yes marks it met</span>
        <span className="err" id="e-met-g-1"></span>
      </HoldBar>
    ),
  },
];
