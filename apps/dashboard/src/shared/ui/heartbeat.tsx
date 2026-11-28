// Upkeep's heartbeat, as the shell's heartbeat writes it (layout.css: .heartbeat, .hb-labels): a cell a
// day, oldest first, today last, shaded by its items (l1-l4), red (bad) when it failed, each titled with its
// day and items; then the first day's label and "today".
import type { CSSProperties } from 'react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type HeartbeatDay = { day: string; items?: string[]; failed?: boolean };

export type HeartbeatProps = {
  days: HeartbeatDay[];
};

// the date as the day it names (Nov 2), whatever the viewer's locale or zone
const dayLabel = (d: string) => {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(d ?? ''));
  return m && +m[1] >= 1 && +m[1] <= 12 ? `${MONTHS[+m[1] - 1]} ${+m[2]}` : String(d ?? '');
};

export default function Heartbeat({ days }: HeartbeatProps) {
  return (
    <>
      <div className="heartbeat" role="img" aria-label={`Upkeep, the last ${days.length} days`} style={{ '--hb-n': days.length || 1 } as CSSProperties}>
        {days.map((d, i) => {
          const items = Array.isArray(d.items) ? d.items.map(String) : [];
          const cls = d.failed ? 'bad' : items.length ? `l${Math.min(4, items.length)}` : '';
          return <i key={i} className={cls} title={`${dayLabel(d.day)}${i === days.length - 1 ? ' (today)' : ''}: ${items.length ? items.join(', ') : 'quiet'}`}></i>;
        })}
      </div>
      <div className="hb-labels"><span>{days.length ? dayLabel(days[0].day) : ''}</span><span>today</span></div>
    </>
  );
}
