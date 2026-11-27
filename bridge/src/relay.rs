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

/// What the app's refusal line said (`REFUSED_CODE`, `UNSUPPORTED_PROTOCOL_CODE` and
/// `SESSION_RECORD_FAILED_CODE` in `electron/agent/handshake.ts`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    /// -32001: the token is unknown, revoked, regenerated, or the handshake was malformed.
    Token,
    /// -32002: the app does not speak the protocol version this bridge sent.
    Protocol,
    /// -32003: the app could not record the session, so it would not start it (X27 section 16.2).
    SessionRecord,
}

/// The exact start of the app's session-record failure line (`SESSION_RECORD_FAILED_PREFIX` in
/// `electron/agent/handshake.ts`). The app writes that line by hand, `error` first, so it starts with
/// these 24 bytes; it may come after other replies, so it is looked for at the start of every line.
pub const RECORD_FAILED_PREFIX: &[u8] = b"{\"error\":{\"code\":-32003,";

/// The longest first line the bridge inspects. A refusal line is under 100 bytes; an MCP reply is not looked at.
const MAX_FIRST_LINE: usize = 1024;

/// Reads the app's first line for a handshake refusal (-32001 or -32002). The app writes it with
/// `JSON.stringify`, so the form is fixed (`"error"` and `"code":-32001`, no whitespace). The reply to
/// the client's first request (`initialize` in the 2025 era, usually `server/discover` in 2026-07-28) is
/// a `result` and carries neither, and a database value inside one is JSON-escaped (`\"code\":-32001`),
/// so a legitimate first message is never mistaken for a refusal. The -32003 line is not looked for
/// here: it can come after a discovery reply, so `ReplyTap` checks the start of every line for it.
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

/// Where a `ReplyTap` leaves its verdict for whoever started the relay.
#[derive(Clone, Default)]
pub struct HandshakeVerdict(Arc<AtomicU8>);

impl HandshakeVerdict {
    fn set(&self, refusal: Refusal) {
        let code = match refusal {
            Refusal::Token => 1,
            Refusal::Protocol => 2,
            Refusal::SessionRecord => 3,
        };
        self.0.store(code, Ordering::SeqCst);
    }

    pub fn get(&self) -> Option<Refusal> {
        match self.0.load(Ordering::SeqCst) {
            1 => Some(Refusal::Token),
            2 => Some(Refusal::Protocol),
            3 => Some(Refusal::SessionRecord),
            _ => None,
        }
    }
}

/// A `Write` that passes everything through unchanged and watches the app's replies go by for a
/// refusal: the first line for a handshake refusal, the start of every line for the session-record
/// failure. Nothing is held back: the Agent client sees what it always saw.
pub struct ReplyTap<W> {
    inner: W,
    line: Vec<u8>,
    done: bool,
    /// How many bytes of the current line have matched `RECORD_FAILED_PREFIX` so far; `None` once it
    /// cannot match, until the next newline starts a line again.
    prefix_matched: Option<usize>,
    verdict: HandshakeVerdict,
}

impl<W: Write> ReplyTap<W> {
    pub fn new(inner: W, verdict: HandshakeVerdict) -> Self {
        ReplyTap { inner, line: Vec::new(), done: false, prefix_matched: Some(0), verdict }
    }

    fn observe(&mut self, written: &[u8]) {
        self.observe_line_starts(written);
        self.observe_first_line(written);
    }

    /// Compares each line's first bytes with `RECORD_FAILED_PREFIX` as they go by, a byte at a time,
    /// so a prefix split across writes still matches. Every line start is the start of a message: the
    /// app writes each as one JSON text and a newline, and JSON holds no raw newline. A database value
    /// that spells the prefix out is inside a message, escaped, and never at a line start.
    fn observe_line_starts(&mut self, written: &[u8]) {
        for &byte in written {
            if byte == b'\n' {
                self.prefix_matched = Some(0);
                continue;
            }
            let Some(matched) = self.prefix_matched else { continue };
            if byte != RECORD_FAILED_PREFIX[matched] {
                self.prefix_matched = None;
            } else if matched + 1 == RECORD_FAILED_PREFIX.len() {
                self.verdict.set(Refusal::SessionRecord);
                self.prefix_matched = None;
            } else {
                self.prefix_matched = Some(matched + 1);
            }
        }
    }

    fn observe_first_line(&mut self, written: &[u8]) {
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

impl<W: Write> Write for ReplyTap<W> {
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
        let mut tap = ReplyTap::new(Vec::new(), verdict.clone());
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

    const RECORD_FAILED: &[u8] =
        b"{\"error\":{\"code\":-32003,\"message\":\"L'Atelier could not record this session\"},\"jsonrpc\":\"2.0\",\"id\":2}\n";
    const DISCOVER_REPLY: &[u8] = b"{\"result\":{\"resultType\":\"complete\",\"supportedVersions\":[\"2026-07-28\"]},\"jsonrpc\":\"2.0\",\"id\":1}\n";

    #[test]
    fn the_prefix_is_the_24_bytes_the_app_writes() {
        assert_eq!(RECORD_FAILED_PREFIX.len(), 24);
        assert!(RECORD_FAILED.starts_with(RECORD_FAILED_PREFIX));
    }

    #[test]
    fn a_record_failure_as_the_first_line_is_recognised_and_forwarded_whole() {
        let (out, verdict) = tapped(&[RECORD_FAILED]);
        assert_eq!(verdict, Some(Refusal::SessionRecord));
        assert_eq!(out, RECORD_FAILED);
    }

    #[test]
    fn a_record_failure_after_a_discovery_reply_is_recognised() {
        let (out, verdict) = tapped(&[DISCOVER_REPLY, RECORD_FAILED]);
        assert_eq!(verdict, Some(Refusal::SessionRecord));
        assert_eq!(out, [DISCOVER_REPLY, RECORD_FAILED].concat());
        // In the same write, too.
        assert_eq!(tapped(&[&[DISCOVER_REPLY, RECORD_FAILED].concat()]).1, Some(Refusal::SessionRecord));
    }

    #[test]
    fn a_record_failure_after_a_first_line_longer_than_the_first_line_check_is_recognised() {
        let mut long = b"{\"result\":{\"instructions\":\"".to_vec();
        long.extend(vec![b'x'; MAX_FIRST_LINE * 3]);
        long.extend_from_slice(b"\"},\"jsonrpc\":\"2.0\",\"id\":1}\n");
        let (out, verdict) = tapped(&[&long, RECORD_FAILED]);
        assert_eq!(verdict, Some(Refusal::SessionRecord));
        assert_eq!(out.len(), long.len() + RECORD_FAILED.len());
    }

    #[test]
    fn a_record_failure_split_across_writes_is_still_recognised() {
        let joined = [DISCOVER_REPLY, RECORD_FAILED].concat();
        // Split inside the prefix, and one byte at a time.
        let at = DISCOVER_REPLY.len() + 10;
        assert_eq!(tapped(&[&joined[..at], &joined[at..]]).1, Some(Refusal::SessionRecord));
        let bytes: Vec<&[u8]> = joined.chunks(1).collect();
        assert_eq!(tapped(&bytes).1, Some(Refusal::SessionRecord));
        // Split right after the newline before it, and right after the prefix.
        let at = DISCOVER_REPLY.len();
        assert_eq!(tapped(&[&joined[..at], &joined[at..]]).1, Some(Refusal::SessionRecord));
        let at = DISCOVER_REPLY.len() + RECORD_FAILED_PREFIX.len();
        assert_eq!(tapped(&[&joined[..at], &joined[at..]]).1, Some(Refusal::SessionRecord));
    }

    #[test]
    fn the_prefix_escaped_inside_a_value_is_not_a_refusal() {
        let reply: &[u8] = b"{\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"{\\\"error\\\":{\\\"code\\\":-32003,\"}]},\"jsonrpc\":\"2.0\",\"id\":4}\n";
        assert_eq!(tapped(&[DISCOVER_REPLY, reply]).1, None);
    }

    #[test]
    fn a_minus_32003_that_does_not_start_a_line_is_not_a_refusal() {
        let mid: &[u8] = b"{\"jsonrpc\":\"2.0\",\"id\":3,\"error\":{\"code\":-32003,\"message\":\"x\"}}\n";
        assert_eq!(tapped(&[DISCOVER_REPLY, mid]).1, None);
        // The prefix itself, but not at a line start.
        let late: &[u8] = b" {\"error\":{\"code\":-32003,\"message\":\"x\"},\"id\":3}\n";
        assert_eq!(tapped(&[DISCOVER_REPLY, late]).1, None);
        // A line that starts like it and then differs.
        let near: &[u8] = b"{\"error\":{\"code\":-32004,\"message\":\"x\"},\"id\":3}\n";
        assert_eq!(tapped(&[near]).1, None);
    }

    #[test]
    fn a_partial_prefix_before_a_newline_does_not_carry_into_the_next_line() {
        // The first 10 bytes of the prefix, a newline, then the rest: no line starts with the whole prefix.
        let mut bytes = RECORD_FAILED_PREFIX[..10].to_vec();
        bytes.push(b'\n');
        bytes.extend_from_slice(&RECORD_FAILED_PREFIX[10..]);
        bytes.push(b'\n');
        assert_eq!(tapped(&[&bytes]).1, None);
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
