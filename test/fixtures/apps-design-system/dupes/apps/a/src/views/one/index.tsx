import Card from '../../shared/ui/card';

const label = '<div className="in-text">not JSX</div>';

export function Solo() {
  return <section className="solo">{label}</section>;
}

export default function One({ n }: { n: number }) {
  if (n < 2) return <Card />;
  return (
    <div className="dup wide" data-n={n}>
      <span className="inner">{n > 3 ? <b className="dup">nested, not outermost</b> : null}</span>
    </div>
  );
}
