// A fixture component (test/apps-design-system.test.mjs): a line of status text, no CSS of its own.
export interface FixtureBetaProps {
  text: string;
  tone?: 'plain' | 'muted';
}

export default function FixtureBeta({ text, tone = 'plain' }: FixtureBetaProps) {
  return <p className={tone === 'muted' ? 'muted' : undefined}>{text}</p>;
}
