//! The Windows relay loop, kept free of any Windows call so every platform
//! compiles and tests it. Only the pipe handle (`pipe_windows.rs`) is
//! Windows-specific.
//!
//! Why one thread. A std `File` opened on `\\.\pipe\...` is a synchronous
//! handle, and Windows serializes synchronous I/O on a handle: a thread parked
//! in `ReadFile` would hold up another thread's `WriteFile` on the same pipe.
//! So the thread that owns the pipe never blocks in a read. It asks
//! `PeekNamedPipe` how many bytes are waiting and reads only those, then sends
//! whatever stdin produced, and sleeps a millisecond when neither had work.
//! Stdin is read on its own thread, which touches no pipe.
//!
//! The windows-only allowance below is for builds on other platforms, where
//! only the tests call this module.

#![cfg_attr(not(windows), allow(dead_code))]

use std::io::{self, Read, Write};
use std::sync::mpsc::{Receiver, TryRecvError};
use std::thread;
use std::time::{Duration, Instant};

use crate::relay::is_closed;

/// A pipe that can say how many bytes are readable without blocking.
pub trait PollPipe: Read + Write {
    fn bytes_available(&mut self) -> io::Result<usize>;
}

pub struct Timing {
    /// Slept when a pass moved no bytes.
    pub idle: Duration,
    /// After stdin ends, how long the pipe may stay silent before the bridge leaves.
    pub drain_grace: Duration,
}

pub const TIMING: Timing = Timing { idle: Duration::from_millis(1), drain_grace: Duration::from_millis(200) };

fn settle(result: io::Result<()>) -> io::Result<()> {
    match result {
        Err(e) if !is_closed(&e) => Err(e),
        _ => Ok(()),
    }
}

/// Moves bytes between `pipe` and `out`/`input` until the pipe closes, or
/// stdin ends and the pipe has been quiet for `drain_grace`.
pub fn run<P, W>(pipe: &mut P, input: &Receiver<Vec<u8>>, out: &mut W, timing: &Timing) -> io::Result<()>
where
    P: PollPipe,
    W: Write,
{
    let mut buf = vec![0u8; 64 * 1024];
    let mut input_ended = false;
    let mut quiet_since: Option<Instant> = None;
    loop {
        let mut moved = false;

        // Pipe to stdout: read only what is already there, so this never blocks.
        match pipe.bytes_available() {
            Ok(0) => {}
            Ok(available) => {
                let want = available.min(buf.len());
                match pipe.read(&mut buf[..want]) {
                    // The app closed its end.
                    Ok(0) => return Ok(()),
                    Ok(got) => {
                        if let Err(e) = out.write_all(&buf[..got]).and_then(|()| out.flush()) {
                            return settle(Err(e));
                        }
                        moved = true;
                    }
                    Err(e) => return settle(Err(e)),
                }
            }
            Err(e) => return settle(Err(e)),
        }

        // Stdin to pipe: one chunk per pass, so a long input cannot starve the read side.
        if !input_ended {
            match input.try_recv() {
                Ok(chunk) => {
                    if let Err(e) = pipe.write_all(&chunk).and_then(|()| pipe.flush()) {
                        return settle(Err(e));
                    }
                    moved = true;
                }
                Err(TryRecvError::Empty) => {}
                // The sender is gone and the queue is empty: stdin ended.
                Err(TryRecvError::Disconnected) => input_ended = true,
            }
        }

        if moved {
            quiet_since = None;
        } else {
            if input_ended && quiet_since.get_or_insert_with(Instant::now).elapsed() >= timing.drain_grace {
                return Ok(());
            }
            thread::sleep(timing.idle);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::mpsc;

    const FAST: Timing = Timing { idle: Duration::from_micros(50), drain_grace: Duration::from_millis(20) };

    /// A pipe whose readable bytes and failures a test scripts.
    #[derive(Default)]
    struct FakePipe {
        readable: VecDeque<u8>,
        written: Vec<u8>,
        /// Reads that must never happen: a read with nothing available would block on a real pipe.
        blocking_reads: usize,
        /// Set to make `bytes_available` fail once `readable` is empty.
        close_after_drain: bool,
        peeks: usize,
        flushes: usize,
    }

    impl Read for FakePipe {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            if self.readable.is_empty() {
                self.blocking_reads += 1;
                return Ok(0);
            }
            let n = buf.len().min(self.readable.len());
            for slot in buf.iter_mut().take(n) {
                *slot = self.readable.pop_front().unwrap();
            }
            Ok(n)
        }
    }

    impl Write for FakePipe {
        fn write(&mut self, data: &[u8]) -> io::Result<usize> {
            self.written.extend_from_slice(data);
            Ok(data.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            self.flushes += 1;
            Ok(())
        }
    }

    impl PollPipe for FakePipe {
        fn bytes_available(&mut self) -> io::Result<usize> {
            self.peeks += 1;
            if self.readable.is_empty() && self.close_after_drain {
                return Err(io::Error::from(io::ErrorKind::BrokenPipe));
            }
            Ok(self.readable.len())
        }
    }

    #[derive(Default)]
    struct Out {
        bytes: Vec<u8>,
        flushes: usize,
    }

    impl Write for Out {
        fn write(&mut self, data: &[u8]) -> io::Result<usize> {
            self.bytes.extend_from_slice(data);
            Ok(data.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            self.flushes += 1;
            Ok(())
        }
    }

    #[test]
    fn available_bytes_are_read_and_flushed_to_stdout() {
        let (tx, rx) = mpsc::channel();
        let mut pipe = FakePipe { readable: b"reply".iter().copied().collect(), close_after_drain: true, ..Default::default() };
        let mut out = Out::default();
        drop(tx);
        run(&mut pipe, &rx, &mut out, &FAST).unwrap();
        assert_eq!(out.bytes, b"reply");
        assert!(out.flushes >= 1);
    }

    #[test]
    fn a_read_never_happens_when_nothing_is_available() {
        let (tx, rx) = mpsc::channel();
        let mut pipe = FakePipe::default();
        let mut out = Out::default();
        drop(tx);
        run(&mut pipe, &rx, &mut out, &FAST).unwrap();
        assert_eq!(pipe.blocking_reads, 0);
        assert!(out.bytes.is_empty());
    }

    #[test]
    fn queued_input_is_written_to_the_pipe_in_order_and_flushed() {
        let (tx, rx) = mpsc::channel();
        tx.send(b"one ".to_vec()).unwrap();
        tx.send(b"two".to_vec()).unwrap();
        drop(tx);
        let mut pipe = FakePipe::default();
        run(&mut pipe, &rx, &mut Out::default(), &FAST).unwrap();
        assert_eq!(pipe.written, b"one two");
        assert_eq!(pipe.flushes, 2);
    }

    #[test]
    fn a_pass_does_both_so_neither_direction_waits_for_the_other() {
        let (tx, rx) = mpsc::channel();
        for i in 0..5u8 {
            tx.send(vec![b'a' + i]).unwrap();
        }
        drop(tx);
        let mut pipe = FakePipe { readable: (0..5u8).map(|i| b'0' + i).collect(), ..Default::default() };
        let mut out = Out::default();
        run(&mut pipe, &rx, &mut out, &FAST).unwrap();
        assert_eq!(out.bytes, b"01234");
        assert_eq!(pipe.written, b"abcde");
    }

    #[test]
    fn input_arriving_later_is_still_written() {
        let (tx, rx) = mpsc::channel();
        let sender = thread::spawn(move || {
            thread::sleep(Duration::from_millis(5));
            tx.send(b"late".to_vec()).unwrap();
        });
        let mut pipe = FakePipe::default();
        run(&mut pipe, &rx, &mut Out::default(), &Timing { idle: Duration::from_micros(50), drain_grace: Duration::from_millis(80) }).unwrap();
        sender.join().unwrap();
        assert_eq!(pipe.written, b"late");
    }

    #[test]
    fn a_closed_pipe_after_the_last_bytes_is_a_clean_end() {
        let (_tx, rx) = mpsc::channel::<Vec<u8>>();
        let mut pipe = FakePipe { readable: b"last".iter().copied().collect(), close_after_drain: true, ..Default::default() };
        let mut out = Out::default();
        // The sender stays alive: only the pipe closing can end this run.
        run(&mut pipe, &rx, &mut out, &FAST).unwrap();
        assert_eq!(out.bytes, b"last");
    }

    #[test]
    fn stdin_ending_waits_for_the_pipe_to_go_quiet_before_leaving() {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        drop(tx);
        let mut pipe = FakePipe::default();
        let started = Instant::now();
        run(&mut pipe, &rx, &mut Out::default(), &FAST).unwrap();
        assert!(started.elapsed() >= FAST.drain_grace);
    }

    #[test]
    fn replies_still_arriving_after_stdin_ends_are_delivered_and_extend_the_wait() {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        drop(tx);
        // Two reads' worth, then silence: the grace restarts after the data.
        let mut pipe = FakePipe { readable: b"tail".iter().copied().collect(), ..Default::default() };
        let mut out = Out::default();
        run(&mut pipe, &rx, &mut out, &FAST).unwrap();
        assert_eq!(out.bytes, b"tail");
    }

    #[test]
    fn a_stdout_that_closed_ends_the_run_cleanly() {
        struct Gone;
        impl Write for Gone {
            fn write(&mut self, _: &[u8]) -> io::Result<usize> {
                Err(io::Error::from(io::ErrorKind::BrokenPipe))
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let (_tx, rx) = mpsc::channel::<Vec<u8>>();
        let mut pipe = FakePipe { readable: b"x".iter().copied().collect(), ..Default::default() };
        run(&mut pipe, &rx, &mut Gone, &FAST).unwrap();
    }

    #[test]
    fn a_real_pipe_error_is_returned() {
        struct Failing;
        impl Read for Failing {
            fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
                Ok(0)
            }
        }
        impl Write for Failing {
            fn write(&mut self, d: &[u8]) -> io::Result<usize> {
                Ok(d.len())
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        impl PollPipe for Failing {
            fn bytes_available(&mut self) -> io::Result<usize> {
                Err(io::Error::from(io::ErrorKind::PermissionDenied))
            }
        }
        let (_tx, rx) = mpsc::channel::<Vec<u8>>();
        let err = run(&mut Failing, &rx, &mut Out::default(), &FAST).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::PermissionDenied);
    }
}
