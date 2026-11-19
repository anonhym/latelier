//! macOS and Linux: a Unix domain socket, two threads.
//!
//! A socket is full duplex and `try_clone` hands each thread its own handle,
//! so one thread copies stdin to the socket while the other copies the socket
//! to stdout, and neither can stall the other.

use std::io::{self, Read, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use crate::relay::{copy_flushing, is_closed, FirstLineTap, HandshakeVerdict, RunError};

/// After stdin ends, how long the app gets to answer what is in flight before the bridge leaves.
const DRAIN_GRACE: Duration = Duration::from_secs(2);

pub fn run(endpoint: &str, handshake: &[u8]) -> Result<(), RunError> {
    let stream = UnixStream::connect(endpoint).map_err(|_| RunError::Unreachable)?;
    let verdict = HandshakeVerdict::default();
    let result = relay(stream, handshake, io::stdin(), FirstLineTap::new(io::stdout(), verdict.clone()));
    // A refusal wins over whatever the close after it looked like: the app sent its line and hung up.
    match verdict.get() {
        Some(refusal) => Err(RunError::Refused(refusal)),
        None => result,
    }
}

enum Finished {
    /// The input ended or failed; the socket's write side is already shut.
    Input(io::Result<()>),
    /// The socket ended or failed.
    Socket(io::Result<()>),
}

/// Sends the handshake, then copies both ways until either side closes.
pub fn relay<R, W>(stream: UnixStream, handshake: &[u8], mut input: R, mut output: W) -> Result<(), RunError>
where
    R: Read + Send + 'static,
    W: Write + Send + 'static,
{
    let mut to_app = stream.try_clone().map_err(RunError::Io)?;
    let mut from_app = stream;
    to_app.write_all(handshake).map_err(RunError::Io)?;

    let (tx, rx) = mpsc::channel();
    let tx_input = tx.clone();
    thread::spawn(move || {
        let copied = copy_flushing(&mut input, &mut to_app).map(|_| ());
        // Tells the app the Agent client is done, so it can end its side.
        let _ = to_app.shutdown(Shutdown::Write);
        let _ = tx_input.send(Finished::Input(copied));
    });
    thread::spawn(move || {
        let copied = copy_flushing(&mut from_app, &mut output).map(|_| ());
        let _ = tx.send(Finished::Socket(copied));
    });

    let settle = |result: io::Result<()>| match result {
        Err(e) if !is_closed(&e) => Err(RunError::Io(e)),
        _ => Ok(()),
    };
    match rx.recv() {
        Ok(Finished::Socket(result)) => settle(result),
        Ok(Finished::Input(Err(e))) => settle(Err(e)),
        // The client closed stdin: give the app a moment to finish replying, then go.
        Ok(Finished::Input(Ok(()))) => match rx.recv_timeout(DRAIN_GRACE) {
            Ok(Finished::Socket(result)) => settle(result),
            _ => Ok(()),
        },
        Err(_) => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Cursor};
    use std::os::unix::net::UnixListener;
    use std::sync::{Arc, Mutex};

    /// A `Write` that keeps what it is given where the test can read it.
    #[derive(Clone, Default)]
    struct Shared(Arc<Mutex<Vec<u8>>>);

    impl Write for Shared {
        fn write(&mut self, data: &[u8]) -> io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(data);
            Ok(data.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    fn socket_pair() -> (UnixStream, UnixStream) {
        UnixStream::pair().unwrap()
    }

    #[test]
    fn the_handshake_goes_first_then_input_is_forwarded_and_replies_come_back() {
        let (client, server) = socket_pair();
        let server_thread = thread::spawn(move || {
            let mut reader = BufReader::new(server.try_clone().unwrap());
            let mut first = String::new();
            reader.read_line(&mut first).unwrap();
            let mut second = String::new();
            reader.read_line(&mut second).unwrap();
            let mut writer = server;
            writer.write_all(format!("echo:{second}").as_bytes()).unwrap();
            (first, second)
        });
        let out = Shared::default();
        relay(client, b"HELLO\n", Cursor::new(b"ping\n".to_vec()), out.clone()).unwrap();
        let (first, second) = server_thread.join().unwrap();
        assert_eq!(first, "HELLO\n");
        assert_eq!(second, "ping\n");
        assert_eq!(out.0.lock().unwrap().as_slice(), b"echo:ping\n");
    }

    #[test]
    fn the_app_closing_ends_the_relay_even_while_stdin_stays_open() {
        struct Blocked(mpsc::Receiver<()>);
        impl Read for Blocked {
            fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
                // Never yields until the test is over: an open stdin.
                let _ = self.0.recv();
                Ok(0)
            }
        }
        let (client, server) = socket_pair();
        let (keep_open, blocked) = mpsc::channel::<()>();
        let server_thread = thread::spawn(move || {
            let mut reader = BufReader::new(server.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let mut writer = server;
            writer.write_all(b"bye\n").unwrap();
            // Dropping both halves closes the socket.
        });
        let out = Shared::default();
        relay(client, b"HELLO\n", Blocked(blocked), out.clone()).unwrap();
        server_thread.join().unwrap();
        assert_eq!(out.0.lock().unwrap().as_slice(), b"bye\n");
        drop(keep_open);
    }

    #[test]
    fn stdin_ending_shuts_the_write_side_so_the_app_sees_the_end() {
        let (client, server) = socket_pair();
        let server_thread = thread::spawn(move || {
            let mut all = Vec::new();
            let mut reader = server.try_clone().unwrap();
            // read_to_end returns only once the bridge has shut its write side.
            reader.read_to_end(&mut all).unwrap();
            let mut writer = server;
            writer.write_all(b"done").unwrap();
            all
        });
        let out = Shared::default();
        relay(client, b"HELLO\n", Cursor::new(b"abc".to_vec()), out.clone()).unwrap();
        assert_eq!(server_thread.join().unwrap(), b"HELLO\nabc");
        assert_eq!(out.0.lock().unwrap().as_slice(), b"done");
    }

    #[test]
    fn both_directions_move_a_megabyte_at_once() {
        let (client, server) = socket_pair();
        let payload: Vec<u8> = (0..1_048_576u32).map(|i| (i % 251) as u8).collect();
        let expected = payload.clone();
        let server_thread = thread::spawn(move || {
            let mut reader = server.try_clone().unwrap();
            let mut writer = server;
            // Echo while still reading: the app writing and reading at the same time.
            let mut hello = [0u8; 6];
            reader.read_exact(&mut hello).unwrap();
            let mut buf = [0u8; 8192];
            loop {
                let n = reader.read(&mut buf).unwrap();
                if n == 0 {
                    return;
                }
                writer.write_all(&buf[..n]).unwrap();
            }
        });
        let out = Shared::default();
        relay(client, b"HELLO\n", Cursor::new(payload), out.clone()).unwrap();
        server_thread.join().unwrap();
        assert_eq!(*out.0.lock().unwrap(), expected);
    }

    #[test]
    fn a_refusal_line_then_a_close_is_a_refusal_and_the_line_is_still_forwarded() {
        let dir = std::env::temp_dir().join(format!("lb-refuse-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.sock");
        let listener = UnixListener::bind(&path).unwrap();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut line = String::new();
            BufReader::new(stream.try_clone().unwrap()).read_line(&mut line).unwrap();
            let mut writer = stream;
            writer
                .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32001,\"message\":\"Agent token refused\"}}\n")
                .unwrap();
        });
        // `run` reads the real stdin, which a test harness gives /dev/null: it ends at once, and the app's line is still waited for.
        let result = run(path.to_str().unwrap(), b"HELLO\n");
        server.join().unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(matches!(result, Err(RunError::Refused(crate::relay::Refusal::Token))), "{result:?}");
    }

    #[test]
    fn a_missing_socket_is_unreachable() {
        let err = run("/nonexistent-dir-for-the-bridge-test/agent.sock", b"x\n").unwrap_err();
        assert!(matches!(err, RunError::Unreachable));
    }

    #[test]
    fn a_stale_socket_file_is_unreachable() {
        let dir = std::env::temp_dir().join(format!("lb-stale-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.sock");
        drop(UnixListener::bind(&path).unwrap());
        let err = run(path.to_str().unwrap(), b"x\n").unwrap_err();
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(matches!(err, RunError::Unreachable));
    }
}
