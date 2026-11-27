// apps-src@1 The back link: under a base path (the alpha at /next) every page shows the alpha's
// own way back to the stable page at the origin's root; at the root it renders nothing. Decided at
// build time from the base path, so the exported HTML and the hydrated page agree. No inline style:
// the browser view's policy is style-src 'self'.
import { BASE_PATH } from './paths';

export const BACK_TEXT = 'Back to the stable page';

export default function BackLink() {
  if (!BASE_PATH) return null;
  return (
    <a className="alpha-back" id="alpha-back" href="/">
      {BACK_TEXT}
    </a>
  );
}
