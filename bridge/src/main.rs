//! `latelier-agent-bridge`: pipes an Agent client's stdio to L'Atelier's local socket (X27 section 4.2).
//!
//! Reads `LATELIER_AGENT_TOKEN`, finds the endpoint, sends one handshake line
//! carrying the token and the working folder, then copies bytes both ways until
//! either side closes. It opens no window, database or Mongo client, never
//! starts the app, and never prints the token.
//!
//! Exit codes: 0 a clean close, 1 the stream broke after it connected, 2 the
//! token is missing or malformed, 3 the app is not reachable, 4 the app
//! refused the session (an unknown or revoked token, a protocol it does not
//! speak, or a session it could not record), 5 the pipe is not served by the
//! current user's process (Windows only; the token was not sent).

mod endpoint;
mod peer;
mod relay;
mod token;

#[cfg(unix)]
mod pipe_unix;
#[cfg(unix)]
use pipe_unix as transport;

mod poll_relay;
#[cfg(windows)]
mod pipe_windows;
#[cfg(windows)]
use pipe_windows as transport;

#[cfg(not(any(unix, windows)))]
compile_error!("latelier-agent-bridge supports Unix and Windows only");

use std::process::ExitCode;

use endpoint::{Env, Platform};
use relay::{Refusal, RunError};
use token::{Token, TokenError, TOKEN_ENV};

/// Printed on exit 3. The Agent client shows this line to the user, so it is exact.
const NOT_RUNNING: &str = "L'Atelier is not running or Agent Access is off";

/// Printed on exit 4. Never names the token, or why the app refused it.
const TOKEN_REFUSED: &str = "L'Atelier refused this Agent token";
const PROTOCOL_REFUSED: &str = "L'Atelier does not support this bridge's protocol version";
/// Also exit 4, but the token is fine: the app could not record the session (X27 section 16.2).
const RECORD_FAILED: &str = "L'Atelier could not start this session; see its log";

fn main() -> ExitCode {
    // `var` fails on a value that is not valid Unicode; a token never is.
    let raw = std::env::var(TOKEN_ENV).unwrap_or_default();
    let token = match Token::parse(&raw) {
        Ok(token) => token,
        Err(TokenError::Missing) => {
            eprintln!("{TOKEN_ENV} is not set");
            return ExitCode::from(2);
        }
        Err(TokenError::Malformed) => {
            // The value is never echoed: it is a secret, or something that looks like one.
            eprintln!("{TOKEN_ENV} must be 1 to 256 characters from A-Z, a-z, 0-9, - and _");
            return ExitCode::from(2);
        }
    };
    drop(raw);

    let env = Env::from_process();
    let endpoint = match endpoint::resolve(Platform::current(), &env, |path| std::fs::read_to_string(path)) {
        Ok(endpoint) => endpoint,
        Err(_) => {
            eprintln!("{NOT_RUNNING}");
            return ExitCode::from(3);
        }
    };

    // Display-only in the app, so a path that is not valid Unicode is sent lossily rather than not at all.
    let folder = std::env::current_dir().ok().map(|dir| dir.to_string_lossy().into_owned());
    match transport::run(&endpoint, token.handshake(folder.as_deref()).as_bytes()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(RunError::Unreachable) => {
            eprintln!("{NOT_RUNNING}");
            ExitCode::from(3)
        }
        Err(RunError::Refused(refusal)) => {
            eprintln!(
                "{}",
                match refusal {
                    Refusal::Token => TOKEN_REFUSED,
                    Refusal::Protocol => PROTOCOL_REFUSED,
                    Refusal::SessionRecord => RECORD_FAILED,
                }
            );
            ExitCode::from(4)
        }
        Err(RunError::PeerRejected(reason)) => {
            eprintln!("latelier-agent-bridge: {reason}");
            ExitCode::from(5)
        }
        Err(RunError::Io(err)) => {
            eprintln!("latelier-agent-bridge: connection lost ({:?})", err.kind());
            ExitCode::from(1)
        }
    }
}
