// Strip Worker-only build artefacts before publishing to Cloudflare Pages.
//
// @cloudflare/vite-plugin writes wrangler.json and .assetsignore into dist/ so
// that `wrangler deploy` can target a Worker. We publish to Pages instead, and
// Pages serves every file in dist/ verbatim — which meant drop.involve.no was
// serving /wrangler.json publicly, local Windows paths and all.
//
// The plugin also writes .wrangler/deploy/config.json, a pointer telling
// wrangler to read dist/wrangler.json instead of wrangler.jsonc. Removing the
// target without removing the pointer makes every wrangler command fail with
// "the redirected configuration path it points to does not exist", so both
// have to go together.
//
// Pages deploys are full snapshots, so removing these files here also removes
// them from the live site on the next deploy.
import { rmSync } from 'node:fs';

rmSync('dist/wrangler.json', { force: true });
rmSync('dist/.assetsignore', { force: true });
rmSync('.wrangler/deploy', { force: true, recursive: true });
