// A gate's result (shell.css css-misc: .gate-dot.ok, .fail, .flaky): its mark, coloured.
export type GateDotProps = {
  state: 'ok' | 'fail' | 'flaky';
};

const MARK = { ok: '✓', fail: '✗', flaky: '≈' } as const;

export default function GateDot({ state }: GateDotProps) {
  return <span className={`gate-dot ${state}`}>{MARK[state]}</span>;
}
