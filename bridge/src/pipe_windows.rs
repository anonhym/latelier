//! Windows: a named pipe, one I/O thread (see `poll_relay.rs` for why).
//!
//! This file is the only place a Windows API is called. They are declared here
//! against kernel32 and advapi32 so the crate stays free of dependencies:
//! `PeekNamedPipe` for the relay, and the handful that check who serves the
//! pipe before the token is sent (`peer.rs` holds the decision). It compiles
//! on Windows only; CI's `bridge-windows` job builds it and runs the bridge
//! against a Node named-pipe server.

use std::ffi::c_void;
use std::fs::{File, OpenOptions};
use std::io::{self, Read, Write};
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::ptr;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use crate::peer::{self, PeerCheck};
use crate::poll_relay::{self, PollPipe};
use crate::relay::{FirstLineTap, HandshakeVerdict, RunError};

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
    /// `BOOL GetNamedPipeServerProcessId(HANDLE, PULONG)`.
    fn GetNamedPipeServerProcessId(pipe: *mut c_void, server_process_id: *mut u32) -> i32;
    /// `HANDLE OpenProcess(DWORD, BOOL, DWORD)`: null on failure.
    fn OpenProcess(desired_access: u32, inherit_handle: i32, process_id: u32) -> *mut c_void;
    /// `HANDLE GetCurrentProcess(void)`: a pseudo-handle, never closed.
    fn GetCurrentProcess() -> *mut c_void;
}

#[link(name = "advapi32")]
extern "system" {
    /// `BOOL OpenProcessToken(HANDLE, DWORD, PHANDLE)`.
    fn OpenProcessToken(process: *mut c_void, desired_access: u32, token: *mut *mut c_void) -> i32;
    /// `BOOL GetTokenInformation(HANDLE, TOKEN_INFORMATION_CLASS, LPVOID, DWORD, PDWORD)`.
    fn GetTokenInformation(
        token: *mut c_void,
        information_class: u32,
        information: *mut c_void,
        information_length: u32,
        return_length: *mut u32,
    ) -> i32;
    /// `BOOL EqualSid(PSID, PSID)`.
    fn EqualSid(sid1: *mut c_void, sid2: *mut c_void) -> i32;
}

/// Opens the pipe so the server can learn who the bridge is but cannot act as it:
/// `SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION`.
const SQOS_IDENTIFICATION: u32 = 0x0010_0000 | 0x0001_0000;
const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
const TOKEN_QUERY: u32 = 0x0008;
/// `TOKEN_INFORMATION_CLASS::TokenUser`.
const TOKEN_USER_CLASS: u32 = 1;

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

/// A `TOKEN_USER` the system filled in. It starts with a pointer to the SID, which lives later in
/// the same buffer, so the buffer is `u64`s to keep that pointer aligned.
struct TokenUser(Vec<u64>);

impl TokenUser {
    fn sid(&self) -> *mut c_void {
        // SAFETY: the buffer was filled by `GetTokenInformation(TokenUser)`, whose result begins
        // with `SID_AND_ATTRIBUTES.Sid`, a pointer; the buffer is 8-aligned and holds at least one.
        unsafe { ptr::read(self.0.as_ptr().cast::<*mut c_void>()) }
    }
}

/// The user a token belongs to, or the failing call and its error code.
fn token_user(token: &OwnedHandle) -> Result<TokenUser, PeerCheck> {
    let failed = |call: &'static str| PeerCheck::Failed { call, code: io::Error::last_os_error().raw_os_error().unwrap_or(0) };
    let mut needed: u32 = 0;
    // SAFETY: a null buffer of length 0 asks only for the size; the handle is a live token, and
    // `needed` is a live local. The call is expected to fail with ERROR_INSUFFICIENT_BUFFER.
    unsafe { GetTokenInformation(token.as_raw_handle(), TOKEN_USER_CLASS, ptr::null_mut(), 0, &mut needed) };
    if needed == 0 {
        return Err(failed("GetTokenInformation"));
    }
    let mut buffer = vec![0u64; peer::words_for(needed)];
    let length = (buffer.len() * 8) as u32;
    // SAFETY: `buffer` is `length` writable bytes, and `needed` is a live local.
    let ok = unsafe { GetTokenInformation(token.as_raw_handle(), TOKEN_USER_CLASS, buffer.as_mut_ptr().cast(), length, &mut needed) };
    if ok == 0 {
        return Err(failed("GetTokenInformation"));
    }
    Ok(TokenUser(buffer))
}

fn owned(raw: *mut c_void, call: &'static str) -> Result<OwnedHandle, PeerCheck> {
    if raw.is_null() {
        return Err(PeerCheck::Failed { call, code: io::Error::last_os_error().raw_os_error().unwrap_or(0) });
    }
    // SAFETY: `raw` is a handle this process just got from the system and nothing else owns.
    Ok(unsafe { OwnedHandle::from_raw_handle(raw) })
}

fn process_token(process: *mut c_void, call: &'static str) -> Result<OwnedHandle, PeerCheck> {
    let mut token: *mut c_void = ptr::null_mut();
    // SAFETY: `process` is a live process handle (or the current-process pseudo-handle) and
    // `token` is a live local the call writes a handle to.
    let ok = unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) };
    if ok == 0 {
        return Err(PeerCheck::Failed { call, code: io::Error::last_os_error().raw_os_error().unwrap_or(0) });
    }
    owned(token, call)
}

/// Whether the process serving `pipe` runs as the same user as this process. Any step that cannot
/// be completed is a `Failed`, never a guess.
fn check_peer(pipe: &File) -> PeerCheck {
    let mut server_pid: u32 = 0;
    // SAFETY: the handle is the open client end of the pipe, and `server_pid` is a live local.
    if unsafe { GetNamedPipeServerProcessId(pipe.as_raw_handle(), &mut server_pid) } == 0 {
        return PeerCheck::Failed { call: "GetNamedPipeServerProcessId", code: io::Error::last_os_error().raw_os_error().unwrap_or(0) };
    }
    let verdict = (|| -> Result<bool, PeerCheck> {
        // SAFETY: plain value arguments; the result is checked for null by `owned`.
        let server = owned(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, server_pid) }, "OpenProcess")?;
        let server_token = process_token(server.as_raw_handle(), "OpenProcessToken (server)")?;
        // SAFETY: the pseudo-handle for this process; it is valid for the whole run and needs no close.
        let own_token = process_token(unsafe { GetCurrentProcess() }, "OpenProcessToken (bridge)")?;
        let server_user = token_user(&server_token)?;
        let own_user = token_user(&own_token)?;
        // SAFETY: both SIDs point into buffers that outlive the call.
        Ok(unsafe { EqualSid(own_user.sid(), server_user.sid()) } != 0)
    })();
    match verdict {
        Ok(true) => PeerCheck::SameUser,
        Ok(false) => PeerCheck::OtherUser,
        Err(failed) => failed,
    }
}

fn open(name: &str) -> io::Result<File> {
    let mut attempt = 0;
    loop {
        match OpenOptions::new().read(true).write(true).security_qos_flags(SQOS_IDENTIFICATION).open(name) {
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
    // Before the first byte: the handshake line is the token.
    peer::enforce(check_peer(&pipe.0)).map_err(RunError::PeerRejected)?;
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

    let verdict = HandshakeVerdict::default();
    let mut out = FirstLineTap::new(io::stdout(), verdict.clone());
    let result = poll_relay::run(&mut pipe, &rx, &mut out, &poll_relay::TIMING).map_err(RunError::Io);
    // A refusal wins over whatever the close after it looked like: the app sent its line and hung up.
    match verdict.get() {
        Some(refusal) => Err(RunError::Refused(refusal)),
        None => result,
    }
}
