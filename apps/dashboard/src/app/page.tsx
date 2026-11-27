// The / route: the dashboard (hash routed, as today), also served at /view/artifact/<id> and
// /view/preview/<name>. It renders its root view, the shell.
import Shell from '../views/shell';

export { viewport } from '../views/shell';

export default function Page() {
  return <Shell />;
}
