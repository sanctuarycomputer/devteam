// kit-988: the shell's page state (spec, State other views read). index.html's top-level lets, which other views
// assign, as one object: an import can't be assigned, so a view reads and writes shell.<name>. Imports no view.
import { appPath } from '../../shared/paths';
import { viewerOf } from '../../lib/shell-page';

export const shell: { DATA: unknown; INBOX_D: unknown; PAGE_VERSION: string | null; PUBLIC: unknown; PREVIEWS: boolean; drafts: Record<string, string> } = {
  DATA: null,
  // the data inboxTitle last counted (inboxCount)
  INBOX_D: null,
  // The dashboard page this tab loaded, by the server's own fingerprint of it (x-devteam-page).
  PAGE_VERSION: null,
  // What the cloud box serves to the public (x-devteam-public, set only by its gateway): { project:
  // { port, root, artifacts: { slug: tree } } }. null on a laptop.
  PUBLIC: null,
  // Whether this box's gateway serves previews (x-devteam-previews, set only by the release that does).
  PREVIEWS: false,
  drafts: {},
};

// The viewer (spec §7): index.html's VIEWER, read once from this page's path within the app and its search.
// null with no location (the build prerendering on Node), and null outside /view/.
let VIEWER: ReturnType<typeof viewerOf> | undefined;
export function viewer(): ReturnType<typeof viewerOf> {
  if (typeof location === 'undefined') return null;
  if (VIEWER === undefined) VIEWER = viewerOf(appPath(), location.search);
  return VIEWER;
}
