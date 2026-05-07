//! Substring search across visible (non-protected) fields.
//!
//! v0.1: case-insensitive substring match across Title, UserName, URL,
//! Notes, and Tags. Protected fields are NOT searched.

use crate::types::EntrySummary;

struct EntryHaystack {
    summary: EntrySummary,
    blob: String,
}

fn build_haystack(entry: &keepass::db::EntryRef<'_>) -> EntryHaystack {
    let title = entry.get_title().unwrap_or("");
    let username = entry.get("UserName").unwrap_or("");
    let url = entry.get("URL").unwrap_or("");
    let notes = entry.get("Notes").unwrap_or("");
    let tags_joined = entry.tags.join(" ");

    let blob = format!("{} {} {} {} {}", title, username, url, notes, tags_joined).to_lowercase();

    let modified = entry
        .times
        .last_modification
        .map(|t| t.format("%Y-%m-%dT%H:%M:%SZ").to_string());

    let summary = EntrySummary {
        uuid: entry.id().uuid().to_string(),
        title: title.to_string(),
        username: if username.is_empty() {
            None
        } else {
            Some(username.to_string())
        },
        url: if url.is_empty() {
            None
        } else {
            Some(url.to_string())
        },
        tags: entry.tags.clone(),
        has_totp: entry.get("otp").is_some(),
        modified,
    };

    EntryHaystack { summary, blob }
}

pub fn search(db: &keepass::Database, query: &str) -> Vec<EntrySummary> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Vec::new();
    }
    db.iter_all_entries()
        .map(|er| build_haystack(&er))
        .filter(|h| h.blob.contains(&needle))
        .map(|h| h.summary)
        .collect()
}
