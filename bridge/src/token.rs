use std::fmt;

/// The environment variable the Agent client puts the token in.
pub const TOKEN_ENV: &str = "LATELIER_AGENT_TOKEN";

/// The handshake protocol this build speaks. The app refuses any other value.
pub const PROTOCOL: u32 = 1;

/// The longest token the app accepts (`TOKEN_RE` in `electron/agent/token.ts`).
const MAX_LEN: usize = 256;

#[derive(Debug, PartialEq, Eq)]
pub enum TokenError {
    /// Unset or empty.
    Missing,
    /// Too long, or a character outside `A-Z a-z 0-9 - _`.
    Malformed,
}

/// A token that passed `^[A-Za-z0-9_-]{1,256}$`.
///
/// The only way to get one is `parse`, and the only thing that can be built
/// from it is the handshake line, which is why the line needs no escaping: a
/// character that would need it never gets this far. `Debug` is written by
/// hand so a stray `{:?}` can never print the secret.
pub struct Token(String);

impl Token {
    pub fn parse(raw: &str) -> Result<Token, TokenError> {
        if raw.is_empty() {
            return Err(TokenError::Missing);
        }
        let allowed = |b: u8| b.is_ascii_alphanumeric() || b == b'-' || b == b'_';
        if raw.len() > MAX_LEN || !raw.bytes().all(allowed) {
            return Err(TokenError::Malformed);
        }
        Ok(Token(raw.to_owned()))
    }

    /// The bridge's first line on the socket (X27 section 4.5).
    pub fn handshake(&self) -> String {
        format!("{{\"agentToken\":\"{}\",\"protocol\":{}}}\n", self.0, PROTOCOL)
    }
}

impl fmt::Debug for Token {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Token(<redacted>)")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_token_alphabet() {
        for ok in ["a", "Z", "0", "-", "_", "abcXYZ019-_", &"a".repeat(MAX_LEN)] {
            assert!(Token::parse(ok).is_ok(), "{ok}");
        }
    }

    #[test]
    fn a_43_character_base64url_token_is_accepted() {
        let t = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";
        assert_eq!(t.len(), 43);
        assert!(Token::parse(t).is_ok());
    }

    #[test]
    fn empty_is_missing() {
        assert_eq!(Token::parse("").unwrap_err(), TokenError::Missing);
    }

    #[test]
    fn every_character_outside_the_alphabet_is_malformed() {
        for bad in [
            "a b", "a\"b", "a\\b", "a\nb", "a\rb", "a\tb", "a.b", "a+b", "a/b", "a=b", "a,b", "a}b", "a{b",
            "a:b", " ", "\u{e9}", "a\u{0}b", "a\u{200b}b", "tok\u{2028}en",
        ] {
            assert_eq!(Token::parse(bad).unwrap_err(), TokenError::Malformed, "{bad:?}");
        }
    }

    #[test]
    fn a_trailing_newline_is_not_trimmed_away() {
        assert_eq!(Token::parse("abc\n").unwrap_err(), TokenError::Malformed);
    }

    #[test]
    fn longer_than_the_app_accepts_is_malformed() {
        assert_eq!(Token::parse(&"a".repeat(MAX_LEN + 1)).unwrap_err(), TokenError::Malformed);
    }

    #[test]
    fn the_handshake_is_one_json_line_with_protocol_1() {
        let t = Token::parse("abc-DEF_123").unwrap();
        assert_eq!(t.handshake(), "{\"agentToken\":\"abc-DEF_123\",\"protocol\":1}\n");
    }

    #[test]
    fn debug_never_prints_the_token() {
        let t = Token::parse("super-secret").unwrap();
        let shown = format!("{t:?}");
        assert!(!shown.contains("super-secret"));
    }
}
