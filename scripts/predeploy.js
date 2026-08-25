// Strip Worker-only build artefacts before publishing to Cloudflare Pages.
//
// @cloudflare/vite-plugin writes wrangler.json and .assetsignore into dist/ so
// that `wrangler deploy` can target a Worker. We publish to Pages instead, and
// Pages serves every file in dist/ verbatim — which meant drop.involve.no was
// serving /wrangler.json publicly, local Windows paths and all.
//
// Pages deploys are full snapshots, so removing the files here removes them
// from the live site on the next deploy.
import { rmSync } from 'node:fs';

for (const file of ['dist/wrangler.json', 'dist/.assetsignore']) {
  rmSync(file, { force: true });
}
