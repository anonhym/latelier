use std::fmt;

/// The environment variable the Agent client puts the token in.
pub const TOKEN_ENV: &str = "LATELIER_AGENT_TOKEN";

/// The handshake protocol this build speaks: 2 adds the working folder (X27 section 16.3).
/// The app accepts 1 and 2 and refuses any other value.
pub const PROTOCOL: u32 = 2;

/// The longest token the app accepts (`TOKEN_RE` in `electron/agent/token.ts`).
const MAX_LEN: usize = 256;

/// The folder is cut to this many bytes, at a character boundary, before it is escaped.
pub const MAX_FOLDER_BYTES: usize = 1024;

/// The longest handshake line the app accepts, newline excluded (`HANDSHAKE_MAX_BYTES` in
/// `electron/agent/token.ts`). The folder is cut further rather than let the line pass it.
pub const MAX_HANDSHAKE_BYTES: usize = 4096;

/// The longest prefix of `s` that is at most `max` bytes and ends on a character boundary.
fn cut_at_char_boundary(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// Appends `c` as it goes inside a JSON string: `"` and `\` escaped, U+0000 to U+001F as `\u00XX`,
/// everything else as it is.
fn push_json_escaped(out: &mut String, c: char) {
    match c {
        '"' => out.push_str("\\\""),
        '\\' => out.push_str("\\\\"),
        c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
        c => out.push(c),
    }
}

/// `s` as the contents of a JSON string, without the quotes.
#[cfg(test)]
fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        push_json_escaped(&mut out, c);
    }
    out
}

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
/// from it is the handshake line, which is why the token needs no escaping: a
/// character that would need it never gets this far. The folder beside it
/// does, and gets it. `Debug` is written by
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

    /// The bridge's first line on the socket (X27 sections 4.5 and 16.3). `folder` is the working
    /// directory, omitted when there is none; it is cut to 1,024 bytes at a character boundary, escaped,
    /// and cut further, a whole character at a time, if the escaped line would pass 4,096 bytes: a
    /// folder never costs the session its handshake.
    pub fn handshake(&self, folder: Option<&str>) -> String {
        let mut line = format!("{{\"agentToken\":\"{}\",\"protocol\":{}", self.0, PROTOCOL);
        if let Some(folder) = folder {
            const OPEN: &str = ",\"folder\":\"";
            // What is left once the key, the closing quote and the closing brace are in.
            let budget = MAX_HANDSHAKE_BYTES.saturating_sub(line.len() + OPEN.len() + 2);
            let mut escaped = String::new();
            for c in cut_at_char_boundary(folder, MAX_FOLDER_BYTES).chars() {
                let before = escaped.len();
                push_json_escaped(&mut escaped, c);
                if escaped.len() > budget {
                    escaped.truncate(before);
                    break;
                }
            }
            line.push_str(OPEN);
            line.push_str(&escaped);
            line.push('"');
        }
        line.push_str("}\n");
        line
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
    fn the_handshake_is_one_json_line_with_protocol_2_and_the_folder() {
        let t = Token::parse("abc-DEF_123").unwrap();
        assert_eq!(
            t.handshake(Some("/Users/ann/Projects/shop")),
            "{\"agentToken\":\"abc-DEF_123\",\"protocol\":2,\"folder\":\"/Users/ann/Projects/shop\"}\n"
        );
    }

    #[test]
    fn the_folder_is_omitted_when_the_os_cannot_report_it() {
        let t = Token::parse("abc").unwrap();
        assert_eq!(t.handshake(None), "{\"agentToken\":\"abc\",\"protocol\":2}\n");
    }

    #[test]
    fn the_escaper_handles_quotes_backslashes_control_characters_and_non_ascii() {
        assert_eq!(json_escape("a\"b"), "a\\\"b");
        assert_eq!(json_escape("C:\\Users\\ann"), "C:\\\\Users\\\\ann");
        assert_eq!(json_escape("\u{0}\u{1}\n\r\t\u{1f}"), "\\u0000\\u0001\\u000a\\u000d\\u0009\\u001f");
        // U+0020 and DEL need nothing; non-ASCII stays as UTF-8.
        assert_eq!(json_escape(" \u{7f}caf\u{e9} \u{6771}\u{4eac} \u{1f600} \u{2028}"), " \u{7f}caf\u{e9} \u{6771}\u{4eac} \u{1f600} \u{2028}");
    }

    /// The `folder` value of a handshake line, unescaped by hand for the few escapes the bridge writes.
    fn folder_of(line: &str) -> String {
        let start = line.find(",\"folder\":\"").expect("a folder key") + ",\"folder\":\"".len();
        let body = &line[start..line.len() - "\"}\n".len()];
        let mut out = String::new();
        let mut chars = body.chars();
        while let Some(c) = chars.next() {
            if c != '\\' {
                out.push(c);
                continue;
            }
            match chars.next().unwrap() {
                'u' => {
                    let hex: String = chars.by_ref().take(4).collect();
                    out.push(char::from_u32(u32::from_str_radix(&hex, 16).unwrap()).unwrap());
                }
                other => out.push(other),
            }
        }
        out
    }

    #[test]
    fn a_folder_with_characters_to_escape_round_trips() {
        let t = Token::parse("abc").unwrap();
        let folder = "/tmp/a \"quoted\" \\ back\u{7}bell/caf\u{e9}";
        let line = t.handshake(Some(folder));
        assert_eq!(folder_of(&line), folder);
        assert!(line.ends_with("\"}\n"));
        assert_eq!(line.matches('\n').count(), 1, "one line only");
    }

    #[test]
    fn the_folder_is_cut_to_1024_bytes_at_a_character_boundary() {
        let t = Token::parse("abc").unwrap();
        assert_eq!(folder_of(&t.handshake(Some(&"x".repeat(1024)))), "x".repeat(1024));
        assert_eq!(folder_of(&t.handshake(Some(&"x".repeat(1025)))), "x".repeat(1024));
        // A three-byte character straddling byte 1,024 is dropped whole, not split.
        let straddling = format!("{}\u{6771}tail", "x".repeat(1022));
        assert_eq!(folder_of(&t.handshake(Some(&straddling))), "x".repeat(1022));
        // One that ends exactly at byte 1,024 is kept.
        let fitting = format!("{}\u{6771}tail", "x".repeat(1021));
        assert_eq!(folder_of(&t.handshake(Some(&fitting))), format!("{}\u{6771}", "x".repeat(1021)));
    }

    #[test]
    fn a_folder_that_escapes_past_the_line_cap_is_cut_further_and_the_line_still_fits() {
        let longest = Token::parse(&"a".repeat(MAX_LEN)).unwrap();
        // Every byte a control character: six bytes each once escaped, 6,144 in all.
        let line = longest.handshake(Some(&"\u{1}".repeat(MAX_FOLDER_BYTES)));
        assert!(line.len() - 1 <= MAX_HANDSHAKE_BYTES, "{} bytes", line.len() - 1);
        let kept = folder_of(&line);
        assert!(!kept.is_empty() && kept.chars().all(|c| c == '\u{1}'));
        // Cut a whole escape at a time: as many as fit, and not one more.
        let base = format!("{{\"agentToken\":\"{}\",\"protocol\":2,\"folder\":\"\"}}", "a".repeat(MAX_LEN)).len();
        assert_eq!(kept.chars().count(), (MAX_HANDSHAKE_BYTES - base) / 6);
        // A quote is two bytes escaped: 1,024 of them fit with room to spare.
        let quotes = longest.handshake(Some(&"\"".repeat(MAX_FOLDER_BYTES)));
        assert_eq!(folder_of(&quotes).len(), MAX_FOLDER_BYTES);
    }

    #[test]
    fn an_empty_folder_is_sent_as_empty() {
        let t = Token::parse("abc").unwrap();
        assert_eq!(t.handshake(Some("")), "{\"agentToken\":\"abc\",\"protocol\":2,\"folder\":\"\"}\n");
    }

    #[test]
    fn debug_never_prints_the_token() {
        let t = Token::parse("super-secret").unwrap();
        let shown = format!("{t:?}");
        assert!(!shown.contains("super-secret"));
    }
}
