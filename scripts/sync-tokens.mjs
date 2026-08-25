#!/usr/bin/env node
/**
 * Keep src/styles/tokens.shared.css identical between DegenNFL and
 * FrozenDegenerates.
 *
 * The shared-design mechanism for these two sites is deliberately the cheapest
 * one that works: one file, copied. No private npm package to publish and
 * version, no git submodule (which is genuinely painful under OneDrive sync).
 * The cost of that choice is that the copy has to actually happen — this script
 * is what makes it a single command rather than a manual diff.
 *
 *   node scripts/sync-tokens.mjs --check ../FrozenDegenerates
 *   node scripts/sync-tokens.mjs --push  ../FrozenDegenerates
 *   node scripts/sync-tokens.mjs --pull  ../FrozenDegenerates
 *
 * --check  report whether the two files agree (exit 1 if not)
 * --push   copy this repo's tokens over the sibling's
 * --pull   copy the sibling's over this repo's
 *
 * Only tokens.shared.css moves. src/styles/brand.css is per-app by design and
 * is never touched — that file is what makes the two sites look like siblings
 * rather than clones.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..', '..');
const REL = join('src', 'styles', 'tokens.shared.css');

const args = process.argv.slice(2);
const mode = ['--check', '--push', '--pull'].find(m => args.includes(m)) ?? '--check';
const siblingArg = args.find(a => !a.startsWith('--'));

if (!siblingArg) {
  console.error('Usage: node scripts/sync-tokens.mjs [--check|--push|--pull] <path-to-sibling-repo>');
  console.error('e.g.   node scripts/sync-tokens.mjs --check ../FrozenDegenerates');
  process.exit(1);
}

const mine = join(HERE, REL);
const theirs = join(resolve(siblingArg), REL);

if (!existsSync(mine)) {
  console.error(`Missing ${mine}`);
  process.exit(1);
}

if (!existsSync(theirs)) {
  console.error(`Missing ${theirs}`);
  console.error('');
  console.error('The sibling repo has not adopted the shared tokens yet. To bootstrap it:');
  console.error(`  node scripts/sync-tokens.mjs --push ${siblingArg}`);
  console.error('');
  console.error('Then, in that repo, add a src/styles/brand.css filling in the same');
  console.error('slots with its own ramp, and point its components at the semantic');
  console.error('names (bg-brand-500 rather than bg-ice-500).');
  if (mode !== '--push') process.exit(1);
}

const readOrEmpty = p => (existsSync(p) ? readFileSync(p, 'utf8') : null);

if (mode === '--check') {
  const a = readFileSync(mine, 'utf8');
  const b = readOrEmpty(theirs);
  if (a === b) {
    console.log('ok: tokens.shared.css is identical in both repos');
    process.exit(0);
  }
  console.error('DRIFT: tokens.shared.css differs between the two repos.');
  console.error(`  this repo: ${mine}`);
  console.error(`  sibling:   ${theirs}`);
  console.error('');
  console.error('Decide which side is right, then --push or --pull.');
  process.exit(1);
}

const [from, to] = mode === '--push' ? [mine, theirs] : [theirs, mine];
const content = readFileSync(from, 'utf8');

if (readOrEmpty(to) === content) {
  console.log('ok: already identical, nothing copied');
  process.exit(0);
}

writeFileSync(to, content);
console.log(`copied ${from}\n    -> ${to}`);
console.log('Remember to commit the change in BOTH repos.');
