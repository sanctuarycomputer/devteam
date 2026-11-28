// A status dot (layout.css: .dot and its tones).
export type DotProps = {
  tone?: 'green' | 'blue' | 'amber' | 'red';
  className?: string;
};

export default function Dot({ tone, className }: DotProps) {
  return <span className={['dot', tone ?? '', className ?? ''].filter(Boolean).join(' ')}></span>;
}
