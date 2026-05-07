//! Types serialized to JS via serde-wasm-bindgen.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupSummary {
    pub uuid: String,
    pub name: String,
    pub icon: Option<u32>,
    pub entry_count: usize,
    pub children: Vec<GroupSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntrySummary {
    pub uuid: String,
    pub title: String,
    pub username: Option<String>,
    pub url: Option<String>,
    pub tags: Vec<String>,
    pub has_totp: bool,
    pub modified: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryDetail {
    pub summary: EntrySummary,
    pub group_path: String,
    pub fields: Vec<FieldDisplay>,
    pub attachments: Vec<AttachmentSummary>,
    pub history_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FieldDisplay {
    Plain { name: String, value: String },
    Masked { name: String, hint: String },
}

impl FieldDisplay {
    pub fn from_value(name: impl Into<String>, raw: &str, protected: bool) -> Self {
        let name = name.into();
        if protected {
            Self::Masked {
                name,
                hint: format!("{} chars", raw.chars().count()),
            }
        } else {
            Self::Plain {
                name,
                value: raw.to_string(),
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentSummary {
    pub name: String,
    pub size_bytes: usize,
}

/// Input for setting a single field on an entry. Deserialized from a JS object
/// via `serde_wasm_bindgen` when callers invoke `Vault::add_entry`.
#[derive(Debug, Deserialize)]
pub struct FieldInput {
    pub name: String,
    pub value: String,
    pub protected: bool,
}

/// Input for creating a new entry inside an existing group.
#[derive(Debug, Deserialize)]
pub struct EntryInput {
    pub group_uuid: String,
    pub title: String,
    pub fields: Vec<FieldInput>,
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn field_display_plain_for_unprotected() {
        let f = FieldDisplay::from_value("Title", "Chase", false);
        match f {
            FieldDisplay::Plain { name, value } => {
                assert_eq!(name, "Title");
                assert_eq!(value, "Chase");
            }
            _ => panic!("expected Plain"),
        }
    }

    #[test]
    fn field_display_masked_for_protected() {
        let f = FieldDisplay::from_value("Password", "hunter2", true);
        match f {
            FieldDisplay::Masked { name, hint } => {
                assert_eq!(name, "Password");
                assert_eq!(hint, "7 chars");
            }
            _ => panic!("expected Masked"),
        }
    }

    #[test]
    fn field_display_masked_counts_unicode() {
        let f = FieldDisplay::from_value("Password", "café\u{2603}", true);
        match f {
            FieldDisplay::Masked { hint, .. } => assert_eq!(hint, "5 chars"),
            _ => panic!("expected Masked"),
        }
    }

    #[test]
    fn group_summary_round_trip_json() {
        let g = GroupSummary {
            uuid: "abc".into(),
            name: "Root".into(),
            icon: None,
            entry_count: 3,
            children: vec![],
        };
        let json = serde_json::to_string(&g).unwrap();
        let parsed: GroupSummary = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "Root");
    }
}
