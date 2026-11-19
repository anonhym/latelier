//! The decision half of the Windows pipe-server check, kept free of any Windows
//! call so every platform compiles and tests it. `pipe_windows.rs` gathers the
//! facts (who runs the process serving the pipe, who owns the pipe object, who is
//! the bridge) and hands them here.
//!
//! Why the check exists. The endpoint file names the pipe, and a crash leaves
//! it behind. Another process of the same machine could then create that pipe
//! name and be handed the token in the first line the bridge writes. The token
//! is only ever sent to a server running as the user who runs the bridge.
//!
//! Two independent facts, both required:
//!
//! 1. The process serving the pipe runs as the bridge's own user. This one is strict.
//! 2. The pipe object is owned by the bridge's own user, or by `BUILTIN\Administrators`.
//!    An administrator's elevated token makes the system record `Administrators` as the owner of
//!    every object that process creates (the token's default owner), so an app run by an
//!    administrator, or a test server on a CI runner, owns its pipe that way. Accepting it
//!    costs nothing: a non-administrator cannot create an object owned by `Administrators`, and
//!    an administrator who wants the token can read it from the app's memory or the user's
//!    profile anyway. It never weakens (1), so a pipe served by another user's process is
//!    refused whoever owns the pipe object.
//!
//! The allowance below is for builds on other platforms, where only the tests
//! call this module.

#![cfg_attr(not(windows), allow(dead_code))]

/// What the facts about the pipe's server came to.
#[derive(Debug, PartialEq, Eq)]
pub enum PeerCheck {
    /// The fact checked is acceptable.
    SameUser,
    /// The process serving the pipe runs as another user.
    OtherProcessUser,
    /// The pipe object is owned by neither this user nor `Administrators`.
    OtherPipeOwner,
    /// A step could not be completed (the Win32 call that failed, and its error code).
    /// The bridge cannot tell who serves the pipe, so it does not send the token.
    Failed { call: &'static str, code: i32 },
}

/// Who owns the pipe object, as `pipe_windows.rs` compared the owner SID.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PipeOwner {
    /// The bridge's own user.
    User,
    /// `BUILTIN\Administrators` (S-1-5-32-544).
    Administrators,
    /// Anyone else.
    Other,
}

/// Whether a process user is the bridge's own, as `pipe_windows.rs` compared the two SIDs.
pub fn process_check(same_user: bool) -> PeerCheck {
    if same_user {
        PeerCheck::SameUser
    } else {
        PeerCheck::OtherProcessUser
    }
}

/// The pipe owner is acceptable when it is the user or `Administrators`.
pub fn owner_check(owner: PipeOwner) -> PeerCheck {
    match owner {
        PipeOwner::User | PipeOwner::Administrators => PeerCheck::SameUser,
        PipeOwner::Other => PeerCheck::OtherPipeOwner,
    }
}

/// Two independent checks that must both pass. The first one that did not is the verdict, so the
/// line the bridge prints names the step that stopped it.
pub fn both(first: PeerCheck, second: PeerCheck) -> PeerCheck {
    if first == PeerCheck::SameUser {
        second
    } else {
        first
    }
}

/// `Ok` only when the token may be sent. The `Err` is the one line the bridge prints:
/// it names the step and never the token.
pub fn enforce(check: PeerCheck) -> Result<(), String> {
    match check {
        PeerCheck::SameUser => Ok(()),
        PeerCheck::OtherProcessUser => {
            Err("the pipe is served by a process running as a different user, so the Agent token was not sent".to_string())
        }
        PeerCheck::OtherPipeOwner => {
            Err("the pipe is owned by a different user (neither you nor Administrators), so the Agent token was not sent".to_string())
        }
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
    fn only_an_acceptable_check_lets_the_token_go() {
        assert_eq!(enforce(PeerCheck::SameUser), Ok(()));
        assert!(enforce(PeerCheck::OtherProcessUser).is_err());
        assert!(enforce(PeerCheck::OtherPipeOwner).is_err());
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
        for check in [PeerCheck::OtherProcessUser, PeerCheck::OtherPipeOwner, PeerCheck::Failed { call: "x", code: 0 }] {
            assert!(enforce(check).unwrap_err().contains("token was not sent"));
        }
    }

    #[test]
    fn each_refusal_names_which_check_stopped_it() {
        let process = enforce(PeerCheck::OtherProcessUser).unwrap_err();
        let owner = enforce(PeerCheck::OtherPipeOwner).unwrap_err();
        assert!(process.contains("process running as a different user"), "{process}");
        assert!(owner.contains("pipe is owned by a different user"), "{owner}");
        assert_ne!(process, owner);
    }

    fn verdict(same_process_user: bool, owner: PipeOwner) -> PeerCheck {
        both(process_check(same_process_user), owner_check(owner))
    }

    #[test]
    fn the_token_goes_only_to_the_users_own_process_and_only_when_the_owner_is_the_user_or_administrators() {
        use PeerCheck::*;
        use PipeOwner::*;
        assert_eq!(verdict(true, User), SameUser);
        assert_eq!(verdict(true, Administrators), SameUser);
        assert_eq!(verdict(true, Other), OtherPipeOwner);
        // The process user check is strict: no pipe owner makes up for another user's process.
        assert_eq!(verdict(false, User), OtherProcessUser);
        assert_eq!(verdict(false, Administrators), OtherProcessUser);
        assert_eq!(verdict(false, Other), OtherProcessUser);
        for (same, owner, allowed) in [
            (true, User, true),
            (true, Administrators, true),
            (true, Other, false),
            (false, User, false),
            (false, Administrators, false),
            (false, Other, false),
        ] {
            assert_eq!(enforce(verdict(same, owner)).is_ok(), allowed, "same={same} owner={owner:?}");
        }
    }

    #[test]
    fn the_first_failure_is_the_verdict() {
        use PeerCheck::*;
        assert_eq!(both(SameUser, SameUser), SameUser);
        assert_eq!(both(SameUser, Failed { call: "GetSecurityInfo", code: 5 }), Failed { call: "GetSecurityInfo", code: 5 });
        assert_eq!(both(Failed { call: "OpenProcess", code: 5 }, OtherPipeOwner), Failed { call: "OpenProcess", code: 5 });
        assert_eq!(both(OtherProcessUser, Failed { call: "GetSecurityInfo", code: 5 }), OtherProcessUser);
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
