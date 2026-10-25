import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
assert.equal(pkg.version, manifest.version);
assert.equal(manifest.manifest_version, 3);
for (const entry of [manifest.background.service_worker, manifest.action.default_popup,
  manifest.options_ui.page, ...manifest.content_scripts.flatMap(script => script.js)]) {
  assert(statSync(join(root, entry)).isFile(), `Missing manifest entry: ${entry}`);
}
const scripts = [...readdirSync(root).filter(name => name.endsWith('.js')),
  ...readdirSync(join(root, 'scripts')).filter(name => name.endsWith('.mjs')).map(name => `scripts/${name}`)];
for (const script of scripts) {
  const result = spawnSync(process.execPath, ['--check', script], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`PASS: manifest entries, version consistency, ${scripts.length} JavaScript syntax checks`);
