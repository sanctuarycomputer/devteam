// The hub's / route, its only route. It renders its root view, the hub shell.
export { metadata, viewport } from '../views/hub-shell';
import HubShell from '../views/hub-shell';

export default function Page() {
  return <HubShell />;
}
