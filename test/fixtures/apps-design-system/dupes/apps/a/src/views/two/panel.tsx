// a comment with <div className="solo"> in it, which is no JSX
export default function Panel<T>(props: { items: T[] }) {
  const many = props.items.length > 1 && <p className={'dup'}>many</p>;
  return (
    <div className="via-ui">
      <i className="inner" />
      {many}
    </div>
  );
}
