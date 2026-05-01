//! Per-entry attachment enumeration helper (JSON-hack workaround).
//! Tracked upstream: https://github.com/sseemayer/keepass-rs/issues/314.

use std::collections::{BTreeMap, HashMap};

pub fn collect_named_attachments(
    entry: &keepass::db::Entry,
    db: &keepass::Database,
) -> BTreeMap<String, Vec<u8>> {
    let entry_json = serde_json::to_value(entry)
        .expect("keepass Entry should always serialize with the `serialization` feature");
    let name_to_id: HashMap<String, usize> = entry_json
        .get("attachments")
        .and_then(|v| v.as_object())
        .map(|m| {
            m.iter()
                .filter_map(|(name, id)| id.as_u64().map(|n| (name.clone(), n as usize)))
                .collect()
        })
        .unwrap_or_default();

    if name_to_id.is_empty() {
        return BTreeMap::new();
    }

    let id_to_content: HashMap<usize, Vec<u8>> = db
        .iter_all_attachments()
        .map(|att_ref| {
            let numeric_id = att_ref.id().id();
            let content = att_ref.data.get().clone();
            (numeric_id, content)
        })
        .collect();

    let mut out = BTreeMap::new();
    for (name, id) in name_to_id {
        if let Some(content) = id_to_content.get(&id) {
            out.insert(name, content.clone());
        }
    }
    out
}

pub fn collect_attachment_summaries(
    entry: &keepass::db::Entry,
    db: &keepass::Database,
) -> Vec<crate::types::AttachmentSummary> {
    collect_named_attachments(entry, db)
        .into_iter()
        .map(|(name, content)| crate::types::AttachmentSummary {
            name,
            size_bytes: content.len(),
        })
        .collect()
}
