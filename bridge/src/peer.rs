//! The decision half of the Windows pipe-server check, kept free of any Windows
//! call so every platform compiles and tests it. `pipe_windows.rs` gathers the
//! facts (who owns the process serving the pipe, who is the bridge) and hands
//! them here.
//!
//! Why the check exists. The endpoint file names the pipe, and a crash leaves
//! it behind. Another process of the same machine could then create that pipe
//! name and be handed the token in the first line the bridge writes. The token
//! is only ever sent to a server running as the user who runs the bridge.
//!
//! The allowance below is for builds on other platforms, where only the tests
//! call this module.

#![cfg_attr(not(windows), allow(dead_code))]

/// What the facts about the pipe's server came to.
#[derive(Debug, PartialEq, Eq)]
pub enum PeerCheck {
    /// The pipe is served by a process running as the user running the bridge.
    SameUser,
    /// It is served by someone else.
    OtherUser,
    /// A step could not be completed (the Win32 call that failed, and its error code).
    /// The bridge cannot tell who serves the pipe, so it does not send the token.
    Failed { call: &'static str, code: i32 },
}

/// `Ok` only when the token may be sent. The `Err` is the one line the bridge prints:
/// it names the step and never the token.
pub fn enforce(check: PeerCheck) -> Result<(), String> {
    match check {
        PeerCheck::SameUser => Ok(()),
        PeerCheck::OtherUser => Err("the pipe is served by a different user, so the Agent token was not sent".to_string()),
        PeerCheck::Failed { call, code } => {
            Err(format!("could not tell who serves the pipe ({call} failed with error {code}), so the Agent token was not sent"))
        }
    }
}

/// `u64` words that hold `bytes` bytes, so a buffer a Win32 call fills with a structure that
/// starts with a pointer is aligned for it.
pub fn words_for(bytes: u32) -> usize {
    (bytes as usize).div_ceil(8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_same_user_may_receive_the_token() {
        assert_eq!(enforce(PeerCheck::SameUser), Ok(()));
        assert!(enforce(PeerCheck::OtherUser).is_err());
    }

    #[test]
    fn a_failed_step_refuses_and_names_the_call_and_code() {
        let message = enforce(PeerCheck::Failed { call: "OpenProcess", code: 5 }).unwrap_err();
        assert!(message.contains("OpenProcess"), "{message}");
        assert!(message.contains("error 5"), "{message}");
        assert!(message.contains("token was not sent"), "{message}");
    }

    #[test]
    fn every_refusal_says_the_token_was_not_sent() {
        for check in [PeerCheck::OtherUser, PeerCheck::Failed { call: "x", code: 0 }] {
            assert!(enforce(check).unwrap_err().contains("token was not sent"));
        }
    }

    #[test]
    fn a_buffer_is_rounded_up_to_whole_words() {
        assert_eq!(words_for(0), 0);
        assert_eq!(words_for(1), 1);
        assert_eq!(words_for(8), 1);
        assert_eq!(words_for(9), 2);
        assert_eq!(words_for(44), 6);
    }
}
