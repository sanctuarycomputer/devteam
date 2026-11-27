// The / route: the dashboard (hash routed, as today), also served at /view/artifact/<id> and
// /view/preview/<name>. It renders its root view, the shell, through the design-system gate
// (apps-src@2): at /#design-system the gate mounts that view, loaded by a dynamic import, in its place.
import Shell from '../views/shell';
import Root from '../views/design-system/gate';

export { viewport } from '../views/shell';

export default function Page() {
  return <Root><Shell /></Root>;
}
