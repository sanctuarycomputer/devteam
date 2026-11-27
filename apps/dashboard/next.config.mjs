// apps-src@1 (APPS.md): a static export, every route <route>/index.html, its base path a build
// setting. turbopack.root is apps/, the folder holding both apps, so the hub can compile
// apps/dashboard/src/shared/.
import { fileURLToPath } from 'node:url';

const basePath = process.env.DEVTEAM_BASE_PATH ?? '';

export default {
  output: 'export',
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
  // inlined at build time: src/shared/paths.ts reads it as the default base path
  env: { DEVTEAM_BASE_PATH: basePath },
  turbopack: { root: fileURLToPath(new URL('..', import.meta.url)).replace(/[\/]$/, '') },
};
