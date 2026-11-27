use std::io::{self, ErrorKind, Read, Write};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;

/// Why `run` ended without a clean close.
#[derive(Debug)]
pub enum RunError {
    /// The endpoint could not be reached: the app is not running, or Agent Access is off.
    Unreachable,
    /// The stream broke after it was connected.
    Io(io::Error),
    /// The app answered the handshake with its refusal line, then closed.
    Refused(Refusal),
    /// The pipe is not served by this user's process (or that could not be established), so the
    /// token was never sent. The text is the one line to print. Windows only.
    #[cfg_attr(not(windows), allow(dead_code))]
    PeerRejected(String),
}

/// What the app's refusal line said (`REFUSED_CODE` and `UNSUPPORTED_PROTOCOL_CODE` in `electron/agent/handshake.ts`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    /// -32001: the token is unknown, revoked, regenerated, or the handshake was malformed.
    Token,
    /// -32002: the app does not speak the protocol version this bridge sent.
    Protocol,
}

/// The longest first line the bridge inspects. A refusal line is under 100 bytes; an MCP reply is not looked at.
const MAX_FIRST_LINE: usize = 1024;

/// Reads the app's first line for a refusal. The app writes it with `JSON.stringify`, so the form is
/// fixed (`"error"` and `"code":-32001`, no whitespace). The reply to the client's first request
/// (`initialize` in the 2025 era, usually `server/discover` in 2026-07-28) is a `result` and carries
/// neither, and a database value inside one is JSON-escaped (`\"code\":-32001`), so a legitimate first
/// message is never mistaken for a refusal.
pub fn classify_first_line(line: &[u8]) -> Option<Refusal> {
    let text = std::str::from_utf8(line).ok()?;
    if !text.contains("\"error\"") {
        return None;
    }
    if text.contains("\"code\":-32001") {
        Some(Refusal::Token)
    } else if text.contains("\"code\":-32002") {
        Some(Refusal::Protocol)
    } else {
        None
    }
}

/// Where a `FirstLineTap` leaves its verdict for whoever started the relay.
#[derive(Clone, Default)]
pub struct HandshakeVerdict(Arc<AtomicU8>);

impl HandshakeVerdict {
    fn set(&self, refusal: Refusal) {
        self.0.store(if refusal == Refusal::Token { 1 } else { 2 }, Ordering::SeqCst);
    }

    pub fn get(&self) -> Option<Refusal> {
        match self.0.load(Ordering::SeqCst) {
            1 => Some(Refusal::Token),
            2 => Some(Refusal::Protocol),
            _ => None,
        }
    }
}

/// A `Write` that passes everything through and watches the first line go by for a refusal.
/// The line is still forwarded: the Agent client sees what it always saw.
pub struct FirstLineTap<W> {
    inner: W,
    line: Vec<u8>,
    done: bool,
    verdict: HandshakeVerdict,
}

impl<W: Write> FirstLineTap<W> {
    pub fn new(inner: W, verdict: HandshakeVerdict) -> Self {
        FirstLineTap { inner, line: Vec::new(), done: false, verdict }
    }

    fn observe(&mut self, written: &[u8]) {
        if self.done {
            return;
        }
        match written.iter().position(|&b| b == b'\n') {
            Some(end) => {
                self.line.extend_from_slice(&written[..end]);
                self.done = true;
                if let Some(refusal) = classify_first_line(&self.line) {
                    self.verdict.set(refusal);
                }
                self.line = Vec::new();
            }
            None => {
                self.line.extend_from_slice(written);
                if self.line.len() > MAX_FIRST_LINE {
                    self.done = true;
                    self.line = Vec::new();
                }
            }
        }
    }
}

impl<W: Write> Write for FirstLineTap<W> {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        let n = self.inner.write(data)?;
        self.observe(&data[..n]);
        Ok(n)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

/// A peer that went away. Either end of the relay closing is the normal way a
/// session ends, so none of these is an error.
pub fn is_closed(err: &io::Error) -> bool {
    matches!(
        err.kind(),
        ErrorKind::BrokenPipe | ErrorKind::ConnectionReset | ErrorKind::ConnectionAborted | ErrorKind::UnexpectedEof
    )
}

/// `io::copy`, except every chunk is flushed. `Stdout` is line-buffered, so a
/// plain copy would hold back a reply that does not end in a newline.
/// Only the Unix relay calls it; the Windows one polls (`poll_relay.rs`).
#[cfg_attr(not(unix), allow(dead_code))]
pub fn copy_flushing<R: Read, W: Write>(reader: &mut R, writer: &mut W) -> io::Result<u64> {
    let mut buf = [0u8; 16 * 1024];
    let mut total: u64 = 0;
    loop {
        let n = match reader.read(&mut buf) {
            Ok(0) => return Ok(total),
            Ok(n) => n,
            Err(e) if e.kind() == ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        writer.write_all(&buf[..n])?;
        writer.flush()?;
        total += n as u64;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Counts flushes, and keeps what was written only once it is flushed.
    #[derive(Default)]
    struct Flushed {
        pending: Vec<u8>,
        flushed: Vec<u8>,
        flushes: usize,
    }

    impl Write for Flushed {
        fn write(&mut self, data: &[u8]) -> io::Result<usize> {
            self.pending.extend_from_slice(data);
            Ok(data.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            self.flushed.append(&mut self.pending);
            self.flushes += 1;
            Ok(())
        }
    }

    /// Yields its chunks one `read` at a time.
    struct Chunks(Vec<Vec<u8>>);

    impl Read for Chunks {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            if self.0.is_empty() {
                return Ok(0);
            }
            let chunk = self.0.remove(0);
            buf[..chunk.len()].copy_from_slice(&chunk);
            Ok(chunk.len())
        }
    }

    #[test]
    fn every_chunk_is_flushed_even_without_a_newline() {
        let mut out = Flushed::default();
        let n = copy_flushing(&mut Chunks(vec![b"ab".to_vec(), b"cd".to_vec()]), &mut out).unwrap();
        assert_eq!(n, 4);
        assert_eq!(out.flushed, b"abcd");
        assert!(out.pending.is_empty());
        assert_eq!(out.flushes, 2);
    }

    #[test]
    fn an_interrupted_read_is_retried() {
        struct Flaky(bool);
        impl Read for Flaky {
            fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
                if !self.0 {
                    self.0 = true;
                    return Err(io::Error::from(ErrorKind::Interrupted));
                }
                buf[0] = b'x';
                self.0 = false;
                Ok(1)
            }
        }
        // Interrupted, then one byte, then (the flag is flipped back) interrupted again, then EOF is not
        // reachable with this reader, so cap it: the first byte proves the retry.
        let mut out = Flushed::default();
        let mut reader = Flaky(false).take(1);
        assert_eq!(copy_flushing(&mut reader, &mut out).unwrap(), 1);
        assert_eq!(out.flushed, b"x");
    }

    #[test]
    fn a_read_error_is_returned() {
        struct Broken;
        impl Read for Broken {
            fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
                Err(io::Error::from(ErrorKind::PermissionDenied))
            }
        }
        let err = copy_flushing(&mut Broken, &mut Flushed::default()).unwrap_err();
        assert_eq!(err.kind(), ErrorKind::PermissionDenied);
    }

    const REFUSAL: &[u8] = b"{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32001,\"message\":\"Agent token refused\"}}\n";
    const UNSUPPORTED: &[u8] = b"{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32002,\"message\":\"Agent protocol not supported\"}}\n";

    fn tapped(chunks: &[&[u8]]) -> (Vec<u8>, Option<Refusal>) {
        let verdict = HandshakeVerdict::default();
        let mut tap = FirstLineTap::new(Vec::new(), verdict.clone());
        for chunk in chunks {
            tap.write_all(chunk).unwrap();
        }
        (tap.inner, verdict.get())
    }

    #[test]
    fn the_refusal_line_is_recognised_and_still_forwarded_whole() {
        let (out, verdict) = tapped(&[REFUSAL]);
        assert_eq!(verdict, Some(Refusal::Token));
        assert_eq!(out, REFUSAL);
        assert_eq!(tapped(&[UNSUPPORTED]).1, Some(Refusal::Protocol));
    }

    #[test]
    fn a_refusal_split_across_writes_is_still_recognised() {
        let (head, tail) = REFUSAL.split_at(30);
        assert_eq!(tapped(&[head, tail]).1, Some(Refusal::Token));
        // Down to one byte at a time.
        let bytes: Vec<&[u8]> = REFUSAL.chunks(1).collect();
        assert_eq!(tapped(&bytes).1, Some(Refusal::Token));
    }

    #[test]
    fn a_reply_to_initialize_is_not_a_refusal() {
        let reply: &[u8] = b"{\"result\":{\"protocolVersion\":\"2025-06-18\",\"instructions\":\"-32001 \\\"code\\\":-32001\"},\"jsonrpc\":\"2.0\",\"id\":0}\n";
        assert_eq!(tapped(&[reply]).1, None);
    }

    #[test]
    fn a_reply_to_server_discover_is_not_a_refusal() {
        let reply: &[u8] = b"{\"result\":{\"resultType\":\"complete\",\"supportedVersions\":[\"2026-07-28\"],\"capabilities\":{\"tools\":{}},\"serverInfo\":{\"name\":\"latelier\",\"version\":\"1\"},\"instructions\":\"\\\"error\\\" \\\"code\\\":-32001\"},\"jsonrpc\":\"2.0\",\"id\":0}\n";
        assert_eq!(tapped(&[reply]).1, None);
    }

    #[test]
    fn an_error_that_is_not_a_refusal_is_not_one() {
        let other: &[u8] = b"{\"jsonrpc\":\"2.0\",\"id\":3,\"error\":{\"code\":-32602,\"message\":\"x\"}}\n";
        assert_eq!(tapped(&[other]).1, None);
    }

    #[test]
    fn only_the_first_line_counts() {
        let (_, verdict) = tapped(&[b"{\"result\":{}}\n", REFUSAL]);
        assert_eq!(verdict, None);
    }

    #[test]
    fn a_first_line_too_long_to_be_a_refusal_is_given_up_on_and_forwarded() {
        let long = vec![b'x'; MAX_FIRST_LINE + 1];
        let (out, verdict) = tapped(&[&long, b"\n", REFUSAL]);
        assert_eq!(verdict, None);
        assert_eq!(out.len(), long.len() + 1 + REFUSAL.len());
    }

    #[test]
    fn a_line_without_a_newline_is_not_judged_yet() {
        assert_eq!(tapped(&[&REFUSAL[..REFUSAL.len() - 1]]).1, None);
    }

    #[test]
    fn a_vanished_peer_is_closed_and_other_errors_are_not() {
        for kind in [ErrorKind::BrokenPipe, ErrorKind::ConnectionReset, ErrorKind::ConnectionAborted, ErrorKind::UnexpectedEof] {
            assert!(is_closed(&io::Error::from(kind)), "{kind:?}");
        }
        for kind in [ErrorKind::PermissionDenied, ErrorKind::TimedOut, ErrorKind::NotFound, ErrorKind::Other] {
            assert!(!is_closed(&io::Error::from(kind)), "{kind:?}");
        }
    }
}
