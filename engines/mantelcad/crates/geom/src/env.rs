//! MantelCAD's environment variables, read in one place.
//!
//! Every variable is `MANTELCAD_<NAME>`. Upstream prefixes are ignored so separate
//! installations do not share recovery directories, control ports, or runtime settings.

use std::ffi::OsString;

/// The current prefix.
pub const PREFIX: &str = "MANTELCAD_";

/// `MANTELCAD_<name>`. `name` is the part after the
/// prefix, e.g. `"RECOVERY_DIR"`.
pub fn var_os(name: &str) -> Option<OsString> {
    lookup(name, |k| std::env::var_os(k))
}

/// [`var_os`] as UTF-8; a value that is not valid UTF-8 counts as unset.
pub fn var(name: &str) -> Option<String> {
    var_os(name).and_then(|v| v.into_string().ok())
}

fn lookup(name: &str, get: impl Fn(&str) -> Option<OsString>) -> Option<OsString> {
    get(&format!("{PREFIX}{name}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
        let m: HashMap<String, OsString> = pairs.iter().map(|(k, v)| ((*k).to_string(), OsString::from(*v))).collect();
        move |k| m.get(k).cloned()
    }

    #[test]
    fn new_prefix_wins_over_legacy() {
        let get = env(&[("MANTELCAD_RECOVERY_DIR", "/new"), ("SOLVECRAFT_RECOVERY_DIR", "/old")]);
        assert_eq!(lookup("RECOVERY_DIR", get), Some(OsString::from("/new")));
    }

    #[test]
    fn upstream_prefixes_are_ignored() {
        for prefix in ["SOLVECRAFT_", "SOLIDCRAFT_"] {
            for name in ["CONTROL_PORT", "RECOVERY_DIR"] {
                let key = format!("{prefix}{name}");
                assert_eq!(lookup(name, env(&[(&key, "upstream")])), None);
            }
        }
    }

    #[test]
    fn unset_in_both_is_none() {
        assert_eq!(lookup("WAYLAND", env(&[("OTHER", "1")])), None);
    }
}
