/**
 * Publish the built site to the `gh-pages` branch.
 *
 *   npm run deploy
 *
 * Builds first (so the Supabase values in your local .env are baked in), then
 * force-pushes dist/ as a single commit on an orphan branch. Nothing from
 * .env is ever committed to the main branch.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();

const root = process.cwd();

let remote;
try {
  remote = run('git', ['remote', 'get-url', 'origin'], root);
} catch {
  console.error('No "origin" remote. Add one, then run this again.');
  process.exit(1);
}

const staging = mkdtempSync(join(tmpdir(), 'poker-pages-'));
try {
  cpSync(join(root, 'dist'), staging, { recursive: true });
  // Without this, Pages runs the output through Jekyll and drops _-prefixed files.
  writeFileSync(join(staging, '.nojekyll'), '');

  run('git', ['init', '-q', '-b', 'gh-pages'], staging);
  run('git', ['add', '-A'], staging);
  run('git', [
    '-c', 'user.email=deploy@local',
    '-c', 'user.name=deploy',
    'commit', '-q', '-m', `Deploy ${new Date().toISOString()}`,
  ], staging);

  // The branch is only ever a snapshot of the latest build, so force is correct.
  run('git', ['push', '-q', '-f', remote, 'gh-pages'], staging);
  console.log('Published dist/ to the gh-pages branch.');
} catch (e) {
  console.error('Deploy failed:\n', e.stderr || e.message);
  process.exit(1);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
