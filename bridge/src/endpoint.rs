use std::io;
use std::path::{Path, PathBuf};

/// Overrides the endpoint; the E2E tests use it for their throwaway profile.
pub const SOCKET_ENV: &str = "LATELIER_AGENT_SOCKET";

/// The app's name, which Electron appends to the platform's application-data
/// directory to form `userData` (`app.setName` in `electron/main.ts`).
const APP_DIR_NAME: &str = "L'Atelier";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    Mac,
    Linux,
    Windows,
}

impl Platform {
    pub fn current() -> Platform {
        if cfg!(target_os = "macos") {
            Platform::Mac
        } else if cfg!(windows) {
            Platform::Windows
        } else {
            Platform::Linux
        }
    }
}

/// The environment variables endpoint resolution reads, collected once so a
/// test can hand it any values without touching the process environment.
#[derive(Clone, Debug, Default)]
pub struct Env {
    pub socket: Option<String>,
    pub home: Option<PathBuf>,
    pub xdg_config_home: Option<PathBuf>,
    pub appdata: Option<PathBuf>,
}

fn non_empty(name: &str) -> Option<std::ffi::OsString> {
    std::env::var_os(name).filter(|v| !v.is_empty())
}

impl Env {
    pub fn from_process() -> Env {
        Env {
            socket: non_empty(SOCKET_ENV).and_then(|v| v.into_string().ok()),
            home: non_empty("HOME").or_else(|| non_empty("USERPROFILE")).map(PathBuf::from),
            xdg_config_home: non_empty("XDG_CONFIG_HOME").map(PathBuf::from),
            appdata: non_empty("APPDATA").map(PathBuf::from),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum EndpointError {
    /// No override, and the home or application-data directory is unknown.
    NoUserData,
    /// The endpoint file is missing: the app is not running, or Agent Access is off.
    NoEndpointFile,
    /// The endpoint file exists but names nothing.
    EmptyEndpointFile,
}

/// Electron's default `userData`: the platform's application-data directory
/// plus the app name. The bridge cannot see `ATELIER_USER_DATA_DIR` (a test
/// instance), which is what `LATELIER_AGENT_SOCKET` is for.
pub fn user_data_dir(platform: Platform, env: &Env) -> Option<PathBuf> {
    let base = match platform {
        Platform::Mac => env.home.as_ref()?.join("Library").join("Application Support"),
        Platform::Linux => match &env.xdg_config_home {
            Some(xdg) => xdg.clone(),
            None => env.home.as_ref()?.join(".config"),
        },
        Platform::Windows => env.appdata.clone()?,
    };
    Some(base.join(APP_DIR_NAME))
}

/// `<userData>/agent/endpoint`, the one-line file `AgentServer` writes.
pub fn endpoint_file(user_data: &Path) -> PathBuf {
    user_data.join("agent").join("endpoint")
}

/// The endpoint a file names: its first line, minus the line ending. The
/// server writes `<path>\n`. Spaces are kept, since a path may hold them.
pub fn parse_endpoint_file(contents: &str) -> Option<String> {
    let line = contents.lines().next()?;
    if line.is_empty() {
        None
    } else {
        Some(line.to_owned())
    }
}

/// The override when set, else the endpoint file under the default `userData`.
/// `read` is injected so a test needs no filesystem.
pub fn resolve<F>(platform: Platform, env: &Env, read: F) -> Result<String, EndpointError>
where
    F: FnOnce(&Path) -> io::Result<String>,
{
    if let Some(socket) = env.socket.as_ref().filter(|s| !s.is_empty()) {
        return Ok(socket.clone());
    }
    let user_data = user_data_dir(platform, env).ok_or(EndpointError::NoUserData)?;
    match read(&endpoint_file(&user_data)) {
        Ok(contents) => parse_endpoint_file(&contents).ok_or(EndpointError::EmptyEndpointFile),
        // Any read failure reads as "not there": a file the user cannot read
        // is one the running app did not write for this user.
        Err(_) => Err(EndpointError::NoEndpointFile),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env() -> Env {
        Env {
            socket: None,
            home: Some(PathBuf::from("/home/u")),
            xdg_config_home: None,
            appdata: Some(PathBuf::from("/appdata")),
        }
    }

    fn never_read(_: &Path) -> io::Result<String> {
        panic!("the endpoint file must not be read")
    }

    #[test]
    fn the_override_wins_and_the_file_is_not_read() {
        let e = Env { socket: Some("/tmp/x.sock".into()), ..env() };
        assert_eq!(resolve(Platform::Mac, &e, never_read), Ok("/tmp/x.sock".to_owned()));
    }

    #[test]
    fn an_empty_override_is_ignored() {
        let e = Env { socket: Some(String::new()), ..env() };
        let got = resolve(Platform::Linux, &e, |_| Ok("/run/agent.sock\n".into()));
        assert_eq!(got, Ok("/run/agent.sock".to_owned()));
    }

    #[test]
    fn mac_user_data_is_under_application_support() {
        assert_eq!(
            user_data_dir(Platform::Mac, &env()),
            Some(PathBuf::from("/home/u/Library/Application Support/L'Atelier"))
        );
    }

    #[test]
    fn linux_user_data_prefers_xdg_config_home_then_dot_config() {
        assert_eq!(user_data_dir(Platform::Linux, &env()), Some(PathBuf::from("/home/u/.config/L'Atelier")));
        let e = Env { xdg_config_home: Some(PathBuf::from("/x")), ..env() };
        assert_eq!(user_data_dir(Platform::Linux, &e), Some(PathBuf::from("/x/L'Atelier")));
    }

    #[test]
    fn windows_user_data_is_under_appdata_and_needs_no_home() {
        let e = Env { home: None, ..env() };
        assert_eq!(user_data_dir(Platform::Windows, &e), Some(PathBuf::from("/appdata").join("L'Atelier")));
    }

    #[test]
    fn a_missing_home_or_appdata_is_reported() {
        let none = Env::default();
        for p in [Platform::Mac, Platform::Linux, Platform::Windows] {
            assert_eq!(resolve(p, &none, never_read), Err(EndpointError::NoUserData));
        }
    }

    #[test]
    fn the_endpoint_file_is_agent_endpoint_under_user_data() {
        let mut seen: Option<PathBuf> = None;
        let got = resolve(Platform::Mac, &env(), |p| {
            seen = Some(p.to_path_buf());
            Ok("/some/agent.sock\n".into())
        });
        assert_eq!(got, Ok("/some/agent.sock".to_owned()));
        assert_eq!(
            seen,
            Some(PathBuf::from("/home/u/Library/Application Support/L'Atelier/agent/endpoint"))
        );
    }

    #[test]
    fn a_windows_pipe_name_with_crlf_is_read_back_whole() {
        let name = r"\\.\pipe\latelier-agent-0123456789abcdef0123456789abcdef";
        let got = resolve(Platform::Windows, &env(), |_| Ok(format!("{name}\r\n")));
        assert_eq!(got, Ok(name.to_owned()));
    }

    #[test]
    fn spaces_inside_the_path_are_kept() {
        assert_eq!(parse_endpoint_file("/a b/agent.sock\n"), Some("/a b/agent.sock".to_owned()));
    }

    #[test]
    fn only_the_first_line_counts() {
        assert_eq!(parse_endpoint_file("/first\n/second\n"), Some("/first".to_owned()));
    }

    #[test]
    fn a_missing_file_is_no_endpoint() {
        let got = resolve(Platform::Mac, &env(), |_| Err(io::Error::from(io::ErrorKind::NotFound)));
        assert_eq!(got, Err(EndpointError::NoEndpointFile));
    }

    #[test]
    fn an_empty_file_names_nothing() {
        for c in ["", "\n", "\r\n"] {
            let got = resolve(Platform::Mac, &env(), |_| Ok(c.into()));
            assert_eq!(got, Err(EndpointError::EmptyEndpointFile), "{c:?}");
        }
    }
}
