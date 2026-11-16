// CHANGELOG.md, imported at build time with Vite's `?raw` (X22 §6.1): no IPC,
// no Node API. Parsed once, when this module first loads.
import changelogMd from '../../../CHANGELOG.md?raw';
import { parseChangelog } from './changelog';

export const BUNDLED_RELEASES = parseChangelog(changelogMd);
