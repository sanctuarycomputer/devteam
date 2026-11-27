// The /browser/ route: the browser view, served at browserViewServer's /. It renders its root view.
import Browser from '../../views/browser';

export const metadata = { title: "Supervisor's browser", referrer: 'no-referrer' };

export default function Page() {
  return <Browser />;
}
