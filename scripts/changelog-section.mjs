#!/usr/bin/env node
// Extracts one version's section from CHANGELOG.md for the GitHub release body
// (X22 §3). A section runs from `## [x.y.z]` up to the next `## [` heading.
//
//   node scripts/changelog-section.mjs <version> [--check] [--file CHANGELOG.md]
//
// Prints the section body, without its heading. `--check` prints nothing and
// only exits non-zero when the heading is missing or the section is empty.
import { readFileSync } from 'node:fs';

export function extractSection(markdown, version) {
  const lines = markdown.split(/\r?\n/);
  const prefix = `## [${version}]`;
  const start = lines.findIndex((l) => l === prefix || l.startsWith(`${prefix} `));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## [')) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n').trim();
}

function main(argv) {
  const args = argv.slice(2);
  const check = args.includes('--check');
  const fileAt = args.indexOf('--file');
  const file = fileAt === -1 ? 'CHANGELOG.md' : args[fileAt + 1];
  const version = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--file');
  if (!version || !file) {
    console.error('usage: changelog-section.mjs <version> [--check] [--file <path>]');
    process.exit(2);
  }
  const section = extractSection(readFileSync(file, 'utf8'), version);
  if (section === null) {
    console.error(`${file} has no "## [${version}]" heading`);
    process.exit(1);
  }
  if (section === '') {
    console.error(`${file} has an empty "## [${version}]" section`);
    process.exit(1);
  }
  if (!check) process.stdout.write(`${section}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
