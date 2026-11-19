// Builds the Agent Bridge (bridge/, X27 section 4.2) and copies each binary to
// build/bridge/<os>-<arch>/latelier-agent-bridge[.exe], the directory
// electron-builder.yml bundles from and electron/agent/bridgePaths.ts reads in
// development.
//
//   node scripts/build-bridge.mjs                          the host
//   node scripts/build-bridge.mjs --targets mac-x64,mac-arm64
//   node scripts/build-bridge.mjs --targets win-x64
//   node scripts/build-bridge.mjs --skip-checks            no cargo test / clippy
//
// Without a Rust toolchain a contributor build only warns and exits 0, so the
// app still runs without the bridge (the app logs it and shows the bridge as
// not installed). Under CI the same condition is an error: a package without
// the bridge must never ship.
//
// cargo runs with bridge/ as its working directory, because rustup reads
// bridge/rust-toolchain.toml from the directory it runs in, not from
// --manifest-path.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bridgeDir = join(root, 'bridge');
const BINARY = 'latelier-agent-bridge';

/** The directory name is `<os>-<arch>`, the same strings `electron-builder` expands `${os}-${arch}` to. */
export const TARGETS = {
  'mac-arm64': { triple: 'aarch64-apple-darwin', file: BINARY },
  'mac-x64': { triple: 'x86_64-apple-darwin', file: BINARY },
  'win-x64': { triple: 'x86_64-pc-windows-msvc', file: `${BINARY}.exe` },
  'win-arm64': { triple: 'aarch64-pc-windows-msvc', file: `${BINARY}.exe` },
  'linux-x64': { triple: 'x86_64-unknown-linux-gnu', file: BINARY },
  'linux-arm64': { triple: 'aarch64-unknown-linux-gnu', file: BINARY },
};

const OS_NAMES = { darwin: 'mac', win32: 'win', linux: 'linux' };

/** The target key for this machine, or null when it is none we ship or test. */
export function hostTarget(platform = process.platform, arch = process.arch) {
  const os = OS_NAMES[platform];
  const key = os ? `${os}-${arch}` : null;
  return key && key in TARGETS ? key : null;
}

/** `--targets a,b` as a list of keys. No flag means the host; an unknown key throws. */
export function parseTargets(argv, host = hostTarget()) {
  const at = argv.indexOf('--targets');
  if (at === -1) {
    if (!host) throw new Error(`no bridge target for ${process.platform}-${process.arch}; pass --targets`);
    return [host];
  }
  const raw = argv[at + 1];
  const keys = (raw ?? '').split(',').filter((k) => k !== '');
  if (keys.length === 0) throw new Error('--targets needs a comma-separated list');
  for (const key of keys) {
    if (!(key in TARGETS)) throw new Error(`unknown bridge target "${key}"; one of ${Object.keys(TARGETS).join(', ')}`);
  }
  return [...new Set(keys)];
}

/** Playwright's own reading of `CI`: unset, empty, `0` and `false` all mean "not CI". */
export function isCi(env = process.env) {
  const ci = env.CI?.toLowerCase();
  return ci !== undefined && ci !== '' && ci !== '0' && ci !== 'false';
}

function cargo(args, options = {}) {
  return spawnSync('cargo', args, { cwd: bridgeDir, env: process.env, ...options });
}

/** Cargo is unavailable when it is not on PATH or rustup cannot give the pinned toolchain. */
function toolchainProblem() {
  const probe = cargo(['--version'], { encoding: 'utf8' });
  if (probe.error) return probe.error.code === 'ENOENT' ? 'cargo is not on PATH' : String(probe.error);
  if (probe.status !== 0) return `cargo --version failed: ${(probe.stderr || probe.stdout).trim()}`;
  return null;
}

function hostTriple() {
  const out = spawnSync('rustc', ['-vV'], { cwd: bridgeDir, env: process.env, encoding: 'utf8' });
  const match = /^host: (\S+)$/m.exec(out.stdout ?? '');
  if (out.status !== 0 || !match) throw new Error(`could not read the rustc host triple: ${out.stderr || out.error}`);
  return match[1];
}

function run(label, args) {
  console.log(`[build-bridge] cargo ${args.join(' ')}`);
  const result = cargo(args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const hint = /^build /.test(label)
      ? `\nIf rustup says the toolchain or a target is not installed: run "rustup toolchain install" in bridge/ and "rustup target add <triple>".`
      : '';
    throw new Error(`${label} failed (exit ${result.status})${hint}`);
  }
}

function main(argv) {
  let targets;
  try {
    targets = parseTargets(argv);
  } catch (err) {
    console.error(`[build-bridge] ${err.message}`);
    return 2;
  }

  const problem = toolchainProblem();
  if (problem) {
    if (isCi()) {
      console.error(`[build-bridge] ${problem}; the bridge is part of every package, so CI cannot skip it`);
      return 1;
    }
    console.warn(`[build-bridge] WARNING: ${problem}. Skipping the Agent Bridge: the app runs, but without a bridge to install.`);
    console.warn('[build-bridge] Install Rust with rustup (https://rustup.rs) to build it.');
    return 0;
  }

  try {
    const host = hostTriple();
    if (!argv.includes('--skip-checks') && targets.some((k) => TARGETS[k].triple === host)) {
      run('cargo test', ['test']);
      run('cargo clippy', ['clippy', '--all-targets', '--', '-D', 'warnings']);
    }
    for (const key of targets) {
      const { triple, file } = TARGETS[key];
      run(`build ${key}`, ['build', '--release', '--target', triple]);
      const built = join(bridgeDir, 'target', triple, 'release', file);
      if (!existsSync(built)) throw new Error(`cargo reported success but ${built} does not exist`);
      const outDir = join(root, 'build', 'bridge', key);
      rmSync(outDir, { recursive: true, force: true });
      mkdirSync(outDir, { recursive: true });
      const dest = join(outDir, file);
      copyFileSync(built, dest);
      chmodSync(dest, 0o755);
      console.log(`[build-bridge] ${key}: ${dest}`);
    }
  } catch (err) {
    console.error(`[build-bridge] ${err.message}`);
    return 1;
  }
  return 0;
}

// pathToFileURL, not a template string: on Windows the path holds backslashes and a drive letter.
if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
