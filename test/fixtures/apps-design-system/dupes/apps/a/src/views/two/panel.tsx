// a comment with <div className="solo"> in it, which is no JSX
const first = <T,>(xs: T[]) => xs[0];
const pick = <K extends Record<string, number>>(k: K) => k;
const keep = <const T,>(v: T) => v;
const link = <a extends="x" href="#">a link</a>;
class Box {
  get = <T = string>(v: T) => v;
}

export default function Panel<T>(props: { items: T[] }) {
  void first; void pick; void Box; void keep; void link;
  const many = props.items.length > 1 && <p className={'dup'}>many</p>;
  return (
    <div className="via-ui">
      <i className="inner" />
      {many}
    </div>
  );
}
