//! Per-entry attachment enumeration helper.
//! Uses EntryRef::attachments_named() from keepass-rs 0.12+.

use std::collections::BTreeMap;

pub fn collect_named_attachments(
    entry_ref: &keepass::db::EntryRef<'_>,
) -> BTreeMap<String, Vec<u8>> {
    entry_ref
        .attachments_named()
        .map(|(name, attachment)| (name.to_string(), attachment.get().clone()))
        .collect()
}

pub fn collect_attachment_summaries(
    entry_ref: &keepass::db::EntryRef<'_>,
) -> Vec<crate::types::AttachmentSummary> {
    entry_ref
        .attachments_named()
        .map(|(name, attachment)| crate::types::AttachmentSummary {
            name: name.to_string(),
            size_bytes: attachment.get().len(),
        })
        .collect()
}
