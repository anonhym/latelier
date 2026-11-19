//! Runs the built bridge as a process: exit codes, the exact stderr line, the
//! handshake bytes on the wire, and what the token does and does not touch.

#[cfg(unix)]
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};

const BIN: &str = env!("CARGO_BIN_EXE_latelier-agent-bridge");
const NOT_RUNNING: &str = "L'Atelier is not running or Agent Access is off\n";
#[cfg(unix)]
const TOKEN_REFUSED: &str = "L'Atelier refused this Agent token\n";
#[cfg(unix)]
const PROTOCOL_REFUSED: &str = "L'Atelier does not support this bridge's protocol version\n";
const SECRET: &str = "s3cret-Token_0123456789";

#[cfg(unix)]
const MISSING_ENDPOINT: &str = "/nonexistent-dir-for-the-bridge-cli-test/agent.sock";
#[cfg(windows)]
const MISSING_ENDPOINT: &str = r"\\.\pipe\latelier-agent-bridge-cli-test-nothing-listens-here";

/// A bridge with a scrubbed environment, so nothing of the developer's own leaks in.
fn bridge() -> Command {
    let mut cmd = Command::new(BIN);
    cmd.env_clear();
    cmd
}

fn run(mut cmd: Command) -> Output {
    cmd.stdin(Stdio::null()).output().unwrap()
}

fn stderr(out: &Output) -> String {
    String::from_utf8_lossy(&out.stderr).into_owned()
}

#[test]
fn a_missing_token_exits_2() {
    let out = run(bridge());
    assert_eq!(out.status.code(), Some(2));
    assert!(stderr(&out).contains("LATELIER_AGENT_TOKEN"));
}

#[test]
fn an_empty_token_exits_2() {
    let mut cmd = bridge();
    cmd.env("LATELIER_AGENT_TOKEN", "");
    assert_eq!(run(cmd).status.code(), Some(2));
}

#[test]
fn a_token_outside_the_alphabet_exits_2_and_is_never_echoed() {
    for bad in ["has space", "quote\"inside", "new\nline", "caf\u{e9}", "a.b", "tok;rm", "back\\slash"] {
        let mut cmd = bridge();
        cmd.env("LATELIER_AGENT_TOKEN", bad).env("LATELIER_AGENT_SOCKET", MISSING_ENDPOINT);
        let out = run(cmd);
        assert_eq!(out.status.code(), Some(2), "{bad:?}");
        assert!(!stderr(&out).contains(bad), "{bad:?} was echoed");
    }
}

#[test]
fn a_token_check_comes_before_the_endpoint_check() {
    let mut cmd = bridge();
    cmd.env("LATELIER_AGENT_TOKEN", "bad token").env("LATELIER_AGENT_SOCKET", MISSING_ENDPOINT);
    assert_eq!(run(cmd).status.code(), Some(2));
}

#[test]
fn an_unreachable_endpoint_exits_3_with_exactly_the_documented_line() {
    let mut cmd = bridge();
    cmd.env("LATELIER_AGENT_TOKEN", SECRET).env("LATELIER_AGENT_SOCKET", MISSING_ENDPOINT);
    let out = run(cmd);
    assert_eq!(out.status.code(), Some(3));
    assert_eq!(stderr(&out), NOT_RUNNING);
    assert!(out.stdout.is_empty());
}

#[test]
fn no_override_and_no_endpoint_file_exits_3() {
    let home = TempDir::new("nohome");
    let mut cmd = bridge();
    cmd.env("LATELIER_AGENT_TOKEN", SECRET)
        .env("HOME", home.path())
        .env("USERPROFILE", home.path())
        .env("APPDATA", home.path())
        .env("XDG_CONFIG_HOME", home.path());
    let out = run(cmd);
    assert_eq!(out.status.code(), Some(3));
    assert_eq!(stderr(&out), NOT_RUNNING);
}

#[test]
fn no_override_and_no_home_at_all_exits_3() {
    let mut cmd = bridge();
    cmd.env("LATELIER_AGENT_TOKEN", SECRET);
    let out = run(cmd);
    assert_eq!(out.status.code(), Some(3));
    assert_eq!(stderr(&out), NOT_RUNNING);
}

/// A directory removed when dropped. Names stay short: a Unix socket path has a small limit.
struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> TempDir {
        use std::sync::atomic::{AtomicU32, Ordering};
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("lb-{}-{}-{}", std::process::id(), n, tag));
        std::fs::create_dir_all(&dir).unwrap();
        TempDir(dir)
    }
    fn path(&self) -> &std::path::Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[cfg(unix)]
mod over_a_socket {
    use super::*;
    use std::io::{BufRead, BufReader, Read};
    use std::os::unix::net::UnixListener;
    use std::thread;

    /// An app stand-in: reads the handshake, reports it, then echoes what it is sent until the bridge shuts its write side.
    fn echo_server(listener: UnixListener) -> thread::JoinHandle<String> {
        thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut handshake = String::new();
            reader.read_line(&mut handshake).unwrap();
            let mut writer = stream;
            let mut rest = Vec::new();
            reader.read_to_end(&mut rest).unwrap();
            writer.write_all(&rest).unwrap();
            handshake
        })
    }

    fn spawn_with(cmd: &mut Command) -> std::process::Child {
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap()
    }

    #[test]
    fn the_handshake_is_the_first_line_and_the_stream_is_piped_both_ways() {
        let dir = TempDir::new("echo");
        let sock = dir.path().join("a.sock");
        let server = echo_server(UnixListener::bind(&sock).unwrap());
        let mut cmd = bridge();
        cmd.env("LATELIER_AGENT_TOKEN", SECRET).env("LATELIER_AGENT_SOCKET", &sock);
        let mut child = spawn_with(&mut cmd);
        let mut stdin = child.stdin.take().unwrap();
        // No trailing newline: a flush bug would hold this back.
        stdin.write_all(b"{\"jsonrpc\":\"2.0\"}").unwrap();
        drop(stdin);
        let out = child.wait_with_output().unwrap();
        assert_eq!(out.status.code(), Some(0));
        assert_eq!(out.stdout, b"{\"jsonrpc\":\"2.0\"}");
        assert_eq!(server.join().unwrap(), format!("{{\"agentToken\":\"{SECRET}\",\"protocol\":1}}\n"));
        assert!(!String::from_utf8_lossy(&out.stderr).contains(SECRET));
    }

    #[test]
    fn the_endpoint_file_under_the_default_user_data_is_followed() {
        let home = TempDir::new("home");
        let user_data = if cfg!(target_os = "macos") {
            home.path().join("Library").join("Application Support").join("L'Atelier")
        } else {
            home.path().join(".config").join("L'Atelier")
        };
        std::fs::create_dir_all(user_data.join("agent")).unwrap();
        let sock = TempDir::new("sock");
        let sock_path = sock.path().join("a.sock");
        let server = echo_server(UnixListener::bind(&sock_path).unwrap());
        std::fs::write(user_data.join("agent").join("endpoint"), format!("{}\n", sock_path.display())).unwrap();
        let mut cmd = bridge();
        cmd.env("LATELIER_AGENT_TOKEN", SECRET).env("HOME", home.path());
        let mut child = spawn_with(&mut cmd);
        let mut stdin = child.stdin.take().unwrap();
        stdin.write_all(b"ping\n").unwrap();
        drop(stdin);
        let out = child.wait_with_output().unwrap();
        assert_eq!(out.status.code(), Some(0));
        assert_eq!(out.stdout, b"ping\n");
        assert!(server.join().unwrap().contains(SECRET));
    }

    #[test]
    fn an_endpoint_file_naming_a_dead_socket_exits_3() {
        let home = TempDir::new("dead");
        let user_data = if cfg!(target_os = "macos") {
            home.path().join("Library").join("Application Support").join("L'Atelier")
        } else {
            home.path().join(".config").join("L'Atelier")
        };
        std::fs::create_dir_all(user_data.join("agent")).unwrap();
        // A socket file nothing listens on: bound, then dropped.
        let sock = TempDir::new("gone");
        let sock_path = sock.path().join("a.sock");
        drop(UnixListener::bind(&sock_path).unwrap());
        std::fs::write(user_data.join("agent").join("endpoint"), format!("{}\n", sock_path.display())).unwrap();
        let mut cmd = bridge();
        cmd.env("LATELIER_AGENT_TOKEN", SECRET).env("HOME", home.path());
        let out = run(cmd);
        assert_eq!(out.status.code(), Some(3));
        assert_eq!(stderr(&out), NOT_RUNNING);
    }

    /// An app stand-in that answers the handshake with `line` and hangs up.
    fn refusing_server(listener: UnixListener, line: &'static str) -> thread::JoinHandle<()> {
        thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut handshake = String::new();
            BufReader::new(stream.try_clone().unwrap()).read_line(&mut handshake).unwrap();
            let mut writer = stream;
            writer.write_all(line.as_bytes()).unwrap();
        })
    }

    const REFUSAL_LINE: &str = "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32001,\"message\":\"Agent token refused\"}}\n";
    const UNSUPPORTED_LINE: &str = "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32002,\"message\":\"Agent protocol not supported\"}}\n";

    #[test]
    fn a_refused_token_exits_4_with_one_line_and_still_forwards_the_apps_line() {
        let dir = TempDir::new("refuse");
        let sock = dir.path().join("a.sock");
        let server = refusing_server(UnixListener::bind(&sock).unwrap(), REFUSAL_LINE);
        let mut cmd = bridge();
        cmd.env("LATELIER_AGENT_TOKEN", SECRET).env("LATELIER_AGENT_SOCKET", &sock);
        let out = run(cmd);
        server.join().unwrap();
        assert_eq!(out.status.code(), Some(4));
        assert_eq!(stderr(&out), TOKEN_REFUSED);
        assert_eq!(out.stdout, REFUSAL_LINE.as_bytes());
        assert!(!String::from_utf8_lossy(&out.stdout).contains(SECRET));
    }

    #[test]
    fn an_unsupported_protocol_exits_4_with_its_own_line() {
        let dir = TempDir::new("proto");
        let sock = dir.path().join("a.sock");
        let server = refusing_server(UnixListener::bind(&sock).unwrap(), UNSUPPORTED_LINE);
        let mut cmd = bridge();
        cmd.env("LATELIER_AGENT_TOKEN", SECRET).env("LATELIER_AGENT_SOCKET", &sock);
        let out = run(cmd);
        server.join().unwrap();
        assert_eq!(out.status.code(), Some(4));
        assert_eq!(stderr(&out), PROTOCOL_REFUSED);
    }

    #[test]
    fn a_close_with_no_refusal_line_is_still_a_clean_exit() {
        // What a revoked token or a quitting app looks like after a session: the socket just ends.
        let dir = TempDir::new("quiet");
        let sock = dir.path().join("a.sock");
        let server = refusing_server(UnixListener::bind(&sock).unwrap(), "");
        let mut cmd = bridge();
        cmd.env("LATELIER_AGENT_TOKEN", SECRET).env("LATELIER_AGENT_SOCKET", &sock);
        let out = run(cmd);
        server.join().unwrap();
        assert_eq!(out.status.code(), Some(0));
        assert_eq!(stderr(&out), "");
    }

    #[test]
    fn the_app_closing_the_socket_ends_the_bridge_with_0_while_stdin_stays_open() {
        let dir = TempDir::new("close");
        let sock = dir.path().join("a.sock");
        let listener = UnixListener::bind(&sock).unwrap();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut line = String::new();
            BufReader::new(stream).read_line(&mut line).unwrap();
            // Dropped here: the app refused the token and closed.
        });
        let mut cmd = bridge();
        cmd.env("LATELIER_AGENT_TOKEN", SECRET).env("LATELIER_AGENT_SOCKET", &sock);
        let mut child = spawn_with(&mut cmd);
        let held_open = child.stdin.take().unwrap();
        server.join().unwrap();
        let status = child.wait().unwrap();
        drop(held_open);
        assert_eq!(status.code(), Some(0));
        let mut err = String::new();
        child.stderr.take().unwrap().read_to_string(&mut err).unwrap();
        assert!(!err.contains(SECRET));
    }
}
