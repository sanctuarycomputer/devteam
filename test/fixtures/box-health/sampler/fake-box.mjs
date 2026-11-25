// A fake box in a folder of the test's own: a cgroup with a 4-CPU, 8 GB cap and a /proc with the
// host's pressure (numbers of its own, so the host's are never mistaken for the box's). write(name,
// text) changes a cgroup file; cpu({ usage, periods, throttled }) moves cpu.stat's counters.
import fs from 'node:fs';
import path from 'node:path';

export const CPU = { usage: 1000e6, periods: 1000, throttled: 100 };
// in use, as machineMemory counts it: memory.current less (file less shmem)
export const CGROUP_BYTES = { current: 6e9, file: 2e9, shmem: 5e8, inUse: 6e9 - 1.5e9, max: 8e9 };
const pressure = (some10, some60, full60) => `some avg10=${some10} avg60=${some60} avg300=0.10 total=1\nfull avg10=0.20 avg60=${full60} avg300=0.10 total=1\n`;
export function fakeBox(dir) {
  const cgroup = path.join(dir, 'cgroup'), proc = path.join(dir, 'proc');
  fs.mkdirSync(cgroup, { recursive: true });
  fs.mkdirSync(path.join(proc, 'pressure'), { recursive: true });
  const write = (name, text) => fs.writeFileSync(path.join(cgroup, name), `${text}\n`);
  const cpu = ({ usage, periods, throttled }) => write('cpu.stat', `usage_usec ${usage}\nuser_usec 1\nsystem_usec 1\nnr_periods ${periods}\nnr_throttled ${throttled}\nthrottled_usec 5`);
  cpu(CPU);
  write('cpu.max', '400000 100000');
  write('cpu.pressure', pressure('3.00', '4.50', '1.00'));
  write('memory.current', CGROUP_BYTES.current);
  write('memory.max', CGROUP_BYTES.max);
  write('memory.stat', `file ${CGROUP_BYTES.file}\nshmem ${CGROUP_BYTES.shmem}\ninactive_file 1000`);
  write('memory.pressure', pressure('1.00', '1.25', '0.00'));
  write('memory.swap.current', 1048576);
  write('memory.swap.max', 2097152);
  write('io.pressure', pressure('2.40', '3.70', '0.50'));
  fs.writeFileSync(path.join(proc, 'pressure', 'cpu'), pressure('50.00', '71.00', '9.00'));
  fs.writeFileSync(path.join(proc, 'pressure', 'memory'), pressure('50.00', '72.00', '9.00'));
  fs.writeFileSync(path.join(proc, 'pressure', 'io'), pressure('60.00', '73.00', '74.00'));
  fs.writeFileSync(path.join(proc, 'meminfo'), 'MemTotal:       1000000 kB\nMemAvailable:    400000 kB\nSwapTotal:         4096 kB\nSwapFree:          3072 kB\n');
  return { cgroup, proc, write, cpu };
}
