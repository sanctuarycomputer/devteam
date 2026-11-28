// The fleet switch, as the shell's fleetSwitch writes it (layout.css: .fleet-switch, .seg): Run, Drain and
// Park (Park asks again while confirming) for a project, a hub row or the machine, with its state's dot and
// words, and a busy or error line. bindFleetSwitch acts on data-fleet and data-confirm, as today.
const FLEET_MODES: [string, string, string][] = [['run', 'Run', 'Workers start and continue tickets'], ['drain', 'Drain', 'Workers finish what they have; nothing new starts'], ['park', 'Park', 'Every session stops where it is']];

export type FleetSwitchProps = {
  scope?: 'project' | 'row' | 'machine';
  mode?: 'run' | 'drain' | 'park' | 'mixed';
  counts?: { running?: number; draining?: number; parked?: number };
  confirming?: boolean;
  busy?: string | null;
  error?: string | null;
  onPress?: (mode: string) => void;
};

export default function FleetSwitch({ scope = 'project', mode = 'run', counts = {}, confirming = false, busy = null, error = null, onPress }: FleetSwitchProps) {
  const c = { running: 0, draining: 0, parked: 0, ...counts };
  const toPark = c.running + c.draining;
  const dot = ({ run: 'green', drain: 'amber', park: '', mixed: 'amber' } as Record<string, string>)[mode] ?? '';
  const label = scope === 'row' ? '' : mode === 'mixed' ? `Mixed: ${c.running} running, ${c.draining} draining, ${c.parked} parked` : scope === 'machine' ? 'Every fleet' : 'Fleet';
  return (
    <div className="fleet-switch" data-scope={scope} data-mode={mode} data-confirming={confirming ? '1' : undefined}>
      <span className="k"><span className={`dot ${dot}`}></span>{label}</span>
      <span className="seg" role="group" aria-label={`${scope === 'machine' ? 'Every fleet on this machine' : scope === 'row' ? 'This project' : 'The whole fleet'}: run, drain or park`}>
        {FLEET_MODES.map(([m, word, why]) => {
          const conf = m === 'park' && confirming;
          const text = conf ? (scope === 'machine' ? `Park ${toPark} project${toPark === 1 ? '' : 's'}?` : 'Confirm park') : word;
          return <button key={m} type="button" data-fleet={m} className={conf ? 'confirm' : undefined} data-confirm={conf ? '1' : undefined} title={why} aria-pressed={mode === m} disabled={busy ? true : undefined} onClick={onPress ? () => onPress(m) : undefined}>{text}</button>;
        })}
      </span>
      {busy ? <span className="msg">{busy}</span> : null}
      {error ? <span className="err">{error}</span> : null}
    </div>
  );
}
