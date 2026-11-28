// override gatewayHubPage sha256:e688b3ef897c43b998191a8b3c4b1cba980b823c381e39658fc545961b687e4f
// apps@1 Serving in the gateway (kit-1021): the hub is the built hub app's folder, the first of
// DEVTEAM_HUB_APP, opts.hubApp and docs/devteam/apps/hub/ in the kit beside the gateway that is a
// non-empty string, resolved once. Nothing is read here: a folder with no build is the hub route's notice,
// never a throw at the gateway's start. What it gives is the `hub` the other two take.
export function gatewayHubPage(opts = {}) {
  const pick = [env.DEVTEAM_HUB_APP, opts.hubApp, path.join(here, '..', 'docs', 'devteam', 'apps', 'hub')].find((d) => typeof d === 'string' && d !== '');
  return { dir: path.resolve(pick) };
}
