// apps-src@1 (apps/dashboard/APPS.md): a static export, every route <route>/index.html, its base
// path a build setting. The hub imports apps/dashboard/src/shared/ as @shared/* (tsconfig.json's
// paths), so turbopack.root is apps/, the folder holding both apps.
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
