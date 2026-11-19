// Smoke test for the built Agent Bridge against a stand-in for the app, written
// in Node so the same script runs on every OS. CI runs it on windows-latest,
// the one place the named-pipe relay (bridge/src/pipe_windows.rs) can run.
//
//   node scripts/bridge-smoke.mjs [path to latelier-agent-bridge[.exe]]
//
// The stand-in listens on a named pipe (Windows) or a Unix socket and checks
// the handshake line byte for byte. Then it does what makes a half-duplex
// relay fail, in the order a real MCP session does:
//   1. it says nothing until the client has sent a line (a request), so a
//      relay thread parked in a read has nothing to return, and a relay whose
//      blocked read stalls the write on the same handle (the Windows rule for
//      synchronous pipe handles) never gets the request out;
//   2. it then answers and, at the same moment, streams a megabyte to the
//      client while the client streams a megabyte back.
// A stalled relay never finishes, so the run is bounded by a timeout.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.platform === 'win32' ? 'latelier-agent-bridge.exe' : 'latelier-agent-bridge';
const defaultBinary = join(root, 'bridge', 'target', 'release', exe);
const binary = resolve(process.argv[2] ?? defaultBinary);

const TOKEN = randomBytes(24).toString('base64url');
const EXPECTED_HANDSHAKE = `{"agentToken":"${TOKEN}","protocol":1}\n`;
const MEGABYTE = 1024 * 1024;
const TIMEOUT_MS = 20_000;

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// What a failing run prints, collected from the start: every bridge child, and
// how far the duplex test got. A hang on CI is otherwise a bare timeout.
const diag = {
  children: [],
  phase: 'not started',
  handshakeSeen: false,
  pingAnswered: false,
  bytesFromBridge: 0,
};

function describeDiagnostics() {
  const lines = [`  phase: ${diag.phase}`];
  lines.push(`  duplex: handshake seen ${diag.handshakeSeen}, ping answered ${diag.pingAnswered}, bytes received from the bridge ${diag.bytesFromBridge}`);
  if (diag.children.length === 0) lines.push('  no bridge child was spawned yet');
  for (const c of diag.children) {
    const state = c.exitCode === null && c.signalCode === null ? 'still running' : `exited (code ${c.exitCode}, signal ${c.signalCode})`;
    lines.push(`  bridge #${c.index} (${c.label}) pid ${c.child.pid ?? 'none'}: ${state}; stdout ${c.stdoutBytes} bytes`);
    lines.push(`    stderr so far: ${JSON.stringify(Buffer.concat(c.stderr).toString('utf8').replaceAll(TOKEN, '<token>'))}`);
  }
  return lines.join('\n');
}

const fail = (message) => {
  console.error(`bridge-smoke: FAIL: ${message}`);
  console.error(describeDiagnostics());
  process.exit(1);
};
const watchdog = setTimeout(() => fail(`no result within ${TIMEOUT_MS} ms (a stalled relay looks like this)`), TIMEOUT_MS);

const scratch = mkdtempSync(join(tmpdir(), 'bs-'));
const endpoint =
  process.platform === 'win32'
    ? `\\\\.\\pipe\\latelier-agent-smoke-${randomBytes(8).toString('hex')}`
    : join(scratch, 'a.sock');

// Two payloads that differ, so a relay that mixed the directions up fails the digest check.
const toApp = randomBytes(MEGABYTE);
const toClient = randomBytes(MEGABYTE);

function spawnBridge(env, label) {
  const child = spawn(binary, [], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const record = { index: diag.children.length + 1, label, child, stderr: [], stdoutBytes: 0, exitCode: null, signalCode: null };
  diag.children.push(record);
  child.stderr.on('data', (c) => record.stderr.push(c));
  child.stdout.on('data', (c) => (record.stdoutBytes += c.length));
  child.on('exit', (code, signal) => {
    record.exitCode = code;
    record.signalCode = signal;
  });
  child.on('error', (err) => record.stderr.push(Buffer.from(`[spawn error] ${err.message}`)));
  // The bridge may leave before stdin is closed; a write after that is not a failure of the test.
  child.stdin.on('error', () => undefined);
  return child;
}

function collect(stream) {
  const chunks = [];
  stream.on('data', (c) => chunks.push(c));
  return () => Buffer.concat(chunks);
}

function exited(child) {
  return new Promise((res, rej) => {
    child.once('error', rej);
    child.once('close', (code) => res(code));
  });
}

// 1. Unreachable endpoint: exit 3 with the one documented line.
async function unreachable() {
  diag.phase = 'unreachable endpoint test';
  const missing =
    process.platform === 'win32' ? `\\\\.\\pipe\\latelier-agent-smoke-none-${randomBytes(4).toString('hex')}` : join(scratch, 'none.sock');
  const child = spawnBridge({ LATELIER_AGENT_TOKEN: TOKEN, LATELIER_AGENT_SOCKET: missing }, 'unreachable');
  const stderr = collect(child.stderr);
  child.stdin.end();
  const code = await exited(child);
  if (code !== 3) fail(`unreachable endpoint: expected exit 3, got ${code}`);
  if (stderr().toString() !== "L'Atelier is not running or Agent Access is off\n") {
    fail(`unreachable endpoint: unexpected stderr ${JSON.stringify(stderr().toString())}`);
  }
  console.log('ok  unreachable endpoint exits 3 with the documented line');
}

// 2. Bad token: exit 2, and the value is not echoed.
async function badToken() {
  diag.phase = 'bad token test';
  const child = spawnBridge({ LATELIER_AGENT_TOKEN: 'bad token!', LATELIER_AGENT_SOCKET: endpoint }, 'bad token');
  const stderr = collect(child.stderr);
  child.stdin.end();
  const code = await exited(child);
  if (code !== 2) fail(`bad token: expected exit 2, got ${code}`);
  if (stderr().toString().includes('bad token')) fail('bad token: the value was echoed to stderr');
  console.log('ok  a malformed token exits 2');
}

// 3. Request first, then a megabyte each way at once.
async function duplex() {
  diag.phase = 'duplex: starting the stand-in server';
  let handshakeSeen = '';
  let receivedFromBridge = Buffer.alloc(0);
  let finished;
  const done = new Promise((res) => (finished = res));
  const PING = Buffer.from('ping\n');
  const PONG = Buffer.from('pong\n');

  const server = net.createServer((socket) => {
    let buffered = Buffer.alloc(0);
    let gotHandshake = false;
    let answered = false;
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (!gotHandshake) {
        const end = buffered.indexOf(0x0a);
        if (end === -1) return;
        handshakeSeen = buffered.subarray(0, end + 1).toString('utf8');
        buffered = buffered.subarray(end + 1);
        gotHandshake = true;
        diag.handshakeSeen = true;
        diag.phase = 'duplex: handshake seen, waiting for the request';
      }
      // Nothing is sent to the bridge until it has forwarded the request.
      if (!answered && buffered.length >= PING.length) {
        if (!buffered.subarray(0, PING.length).equals(PING)) fail('duplex: the first line after the handshake was not the request');
        buffered = buffered.subarray(PING.length);
        answered = true;
        diag.pingAnswered = true;
        diag.phase = 'duplex: request answered, streaming both ways';
        socket.write(Buffer.concat([PONG, toClient]));
      }
      if (answered) diag.bytesFromBridge = buffered.length;
      if (answered && buffered.length >= toApp.length) {
        receivedFromBridge = buffered;
        // Everything the bridge had to say has arrived; let it go.
        socket.end();
        finished();
      }
    });
    socket.on('error', () => undefined);
  });
  await new Promise((res, rej) => {
    server.once('error', rej);
    server.listen(endpoint, res);
  });

  const child = spawnBridge({ LATELIER_AGENT_TOKEN: TOKEN, LATELIER_AGENT_SOCKET: endpoint }, 'duplex');
  const stdout = collect(child.stdout);
  const stderr = collect(child.stderr);
  diag.phase = 'duplex: bridge spawned, request written, waiting for the handshake';
  child.stdin.write(PING);
  // The payload goes out once the answer has come back: both directions are then busy together.
  await new Promise((res) => {
    const poll = setInterval(() => {
      if (stdout().length >= PONG.length) {
        clearInterval(poll);
        res();
      }
    }, 5);
  });
  diag.phase = 'duplex: answer received by the client, writing the payload';
  // Written in 64 KiB pieces, so it overlaps with the megabyte coming the other way.
  for (let at = 0; at < toApp.length; at += 65_536) {
    if (!child.stdin.write(toApp.subarray(at, at + 65_536))) await new Promise((res) => child.stdin.once('drain', res));
  }
  diag.phase = 'duplex: payload written, waiting for the app to receive it all';
  await done;
  diag.phase = 'duplex: waiting for the bridge to exit';
  // The app closed its side: the bridge must leave on its own, stdin still open.
  const code = await exited(child);
  server.close();

  if (code !== 0) fail(`duplex: expected exit 0, got ${code} (stderr ${JSON.stringify(stderr().toString())})`);
  if (handshakeSeen !== EXPECTED_HANDSHAKE) fail(`duplex: handshake was ${JSON.stringify(handshakeSeen.replace(TOKEN, '<token>'))}`);
  if (sha(receivedFromBridge) !== sha(toApp)) fail(`duplex: the app received ${receivedFromBridge.length} bytes that differ from what stdin sent`);
  if (sha(stdout()) !== sha(Buffer.concat([PONG, toClient]))) fail(`duplex: stdout carried ${stdout().length} bytes that differ from what the app sent`);
  if (stderr().toString().includes(TOKEN)) fail('duplex: the token reached stderr');
  console.log(`ok  request first, then ${MEGABYTE} bytes each way at once, the handshake exact, and a clean exit when the app closes`);
}

try {
  await unreachable();
  await badToken();
  await duplex();
  diag.phase = 'done';
  console.log('bridge-smoke: PASS');
} finally {
  clearTimeout(watchdog);
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(0);
