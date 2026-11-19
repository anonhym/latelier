use std::io::{self, ErrorKind, Read, Write};

/// Why `run` ended without a clean close.
#[derive(Debug)]
pub enum RunError {
    /// The endpoint could not be reached: the app is not running, or Agent Access is off.
    Unreachable,
    /// The stream broke after it was connected.
    Io(io::Error),
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
