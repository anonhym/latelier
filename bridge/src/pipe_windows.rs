//! Windows: a named pipe, one I/O thread (see `poll_relay.rs` for why).
//!
//! This file is the only place a Windows API is called, and the only call is
//! `PeekNamedPipe`, declared here against kernel32 so the crate stays free of
//! dependencies. It compiles on Windows only; CI's `bridge-windows` job builds
//! it and runs the bridge against a Node named-pipe server.

use std::ffi::c_void;
use std::fs::{File, OpenOptions};
use std::io::{self, Read, Write};
use std::os::windows::io::AsRawHandle;
use std::ptr;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use crate::poll_relay::{self, PollPipe};
use crate::relay::RunError;

#[link(name = "kernel32")]
extern "system" {
    /// `BOOL PeekNamedPipe(HANDLE, LPVOID, DWORD, LPDWORD, LPDWORD, LPDWORD)`.
    fn PeekNamedPipe(
        named_pipe: *mut c_void,
        buffer: *mut c_void,
        buffer_size: u32,
        bytes_read: *mut u32,
        total_bytes_avail: *mut u32,
        bytes_left_this_message: *mut u32,
    ) -> i32;
}

/// `ERROR_PIPE_BUSY`: every instance of the pipe is serving a client for the moment.
const ERROR_PIPE_BUSY: i32 = 231;
const BUSY_RETRIES: u32 = 20;
const BUSY_WAIT: Duration = Duration::from_millis(50);

struct Pipe(File);

impl Read for Pipe {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.0.read(buf)
    }
}

impl Write for Pipe {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.write(buf)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.0.flush()
    }
}

impl PollPipe for Pipe {
    fn bytes_available(&mut self) -> io::Result<usize> {
        let mut available: u32 = 0;
        // SAFETY: the handle is the open pipe `self.0` owns for the whole call. A null data
        // buffer with size 0 asks only for the byte count, and the one out-pointer that is not
        // null points at a live local.
        let ok = unsafe {
            PeekNamedPipe(
                self.0.as_raw_handle(),
                ptr::null_mut(),
                0,
                ptr::null_mut(),
                &mut available,
                ptr::null_mut(),
            )
        };
        if ok == 0 {
            // ERROR_BROKEN_PIPE comes back as ErrorKind::BrokenPipe: the app closed its end.
            Err(io::Error::last_os_error())
        } else {
            Ok(available as usize)
        }
    }
}

fn open(name: &str) -> io::Result<File> {
    let mut attempt = 0;
    loop {
        match OpenOptions::new().read(true).write(true).open(name) {
            Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) && attempt < BUSY_RETRIES => {
                attempt += 1;
                thread::sleep(BUSY_WAIT);
            }
            other => return other,
        }
    }
}

pub fn run(endpoint: &str, handshake: &[u8]) -> Result<(), RunError> {
    let mut pipe = Pipe(open(endpoint).map_err(|_| RunError::Unreachable)?);
    pipe.write_all(handshake).and_then(|()| pipe.flush()).map_err(RunError::Io)?;

    // Stdin gets its own thread, and that thread never touches the pipe. The channel is
    // bounded so a client that writes faster than the pipe drains cannot grow memory.
    let (tx, rx) = mpsc::sync_channel::<Vec<u8>>(16);
    thread::spawn(move || {
        let mut stdin = io::stdin().lock();
        let mut buf = [0u8; 16 * 1024];
        loop {
            match stdin.read(&mut buf) {
                Ok(0) => return,
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        return;
                    }
                }
                Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                // A broken stdin ends the input like EOF does; dropping the sender says so.
                Err(_) => return,
            }
        }
    });

    poll_relay::run(&mut pipe, &rx, &mut io::stdout(), &poll_relay::TIMING).map_err(RunError::Io)
}
