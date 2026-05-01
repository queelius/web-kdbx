//! The Vault: wraps a keepass::Database and exposes browser-shaped accessors.

use crate::types::*;
use serde_wasm_bindgen::to_value;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Vault {
    db: keepass::Database,
}

#[wasm_bindgen]
impl Vault {
    /// Open a KDBX file. On any error returns a JsError with the conflated
    /// message "Wrong password or corrupt file." This conflation is
    /// deliberate per the spec (security: don't leak whether a file is
    /// valid KDBX before the password is known).
    #[wasm_bindgen(constructor)]
    pub fn open(bytes: &[u8], password: &str) -> Result<Vault, JsError> {
        let key = keepass::DatabaseKey::new().with_password(password);
        let mut reader = std::io::Cursor::new(bytes);
        let db = keepass::Database::open(&mut reader, key)
            .map_err(|_| JsError::new("Wrong password or corrupt file."))?;
        Ok(Vault { db })
    }

    pub fn name(&self) -> Option<String> {
        self.db.meta.database_name.clone()
    }

    pub fn version(&self) -> String {
        self.db.config.version.to_string()
    }

    /// Return the full group hierarchy as a serializable tree.
    pub fn group_tree(&self) -> Result<JsValue, JsError> {
        let root_ref = self.db.root();
        let summary = walk_group(&root_ref);
        to_value(&summary).map_err(|e| JsError::new(&e.to_string()))
    }

    pub fn entries_in_group(&self, group_uuid: &str) -> Result<JsValue, JsError> {
        let target = match uuid::Uuid::parse_str(group_uuid) {
            Ok(u) => u,
            Err(_) => return to_value(&Vec::<EntrySummary>::new())
                .map_err(|e| JsError::new(&e.to_string())),
        };

        let root_id = self.db.root().id();
        let summaries: Vec<EntrySummary> = match find_group(&self.db, root_id, target) {
            Some(g) => g.entries().map(|er| build_entry_summary(&er)).collect(),
            None => Vec::new(),
        };

        to_value(&summaries).map_err(|e| JsError::new(&e.to_string()))
    }

    pub fn entry(&self, entry_uuid: &str) -> Result<JsValue, JsError> {
        let target = match uuid::Uuid::parse_str(entry_uuid) {
            Ok(u) => u,
            Err(_) => return to_value(&Option::<EntryDetail>::None)
                .map_err(|e| JsError::new(&e.to_string())),
        };

        let root_id = self.db.root().id();
        let detail = find_entry_with_path(&self.db, root_id, target, "")
            .map(|(entry_ref, group_path)| build_entry_detail(entry_ref, group_path, &self.db));

        to_value(&detail).map_err(|e| JsError::new(&e.to_string()))
    }
}

fn walk_group(group: &keepass::db::GroupRef<'_>) -> GroupSummary {
    let uuid = group.id().uuid().to_string();
    let name = group.name.clone();
    let icon = match group.icon() {
        Some(keepass::db::Icon::BuiltIn(n)) => Some(*n as u32),
        _ => None,
    };
    let entry_count = group.entries().count();
    let children: Vec<GroupSummary> = group.groups().map(|child_ref| walk_group(&child_ref)).collect();
    GroupSummary { uuid, name, icon, entry_count, children }
}

impl Vault {
    pub(crate) fn find_entry(&self, uuid_str: &str) -> Option<keepass::db::EntryRef<'_>> {
        let target = uuid::Uuid::parse_str(uuid_str).ok()?;
        self.db
            .iter_all_entries()
            .find(|er| er.id().uuid() == target)
    }
}

fn find_group<'a>(
    db: &'a keepass::Database,
    group_id: keepass::db::GroupId,
    target: uuid::Uuid,
) -> Option<keepass::db::GroupRef<'a>> {
    let group = db.group(group_id)?;
    if group.id().uuid() == target {
        return Some(group);
    }
    let child_ids: Vec<keepass::db::GroupId> = group.group_ids().collect();
    for child_id in child_ids {
        if let Some(found) = find_group(db, child_id, target) {
            return Some(found);
        }
    }
    None
}

fn find_entry_with_path<'a>(
    db: &'a keepass::Database,
    group_id: keepass::db::GroupId,
    target: uuid::Uuid,
    path_so_far: &str,
) -> Option<(keepass::db::EntryRef<'a>, String)> {
    let group = db.group(group_id)?;
    let here = if path_so_far.is_empty() {
        format!("/{}", group.name)
    } else {
        format!("{}/{}", path_so_far, group.name)
    };

    let entry_ids: Vec<keepass::db::EntryId> = group.entry_ids().collect();
    for eid in entry_ids {
        if let Some(er) = db.entry(eid) {
            if er.id().uuid() == target {
                return Some((er, here.clone()));
            }
        }
    }
    let child_ids: Vec<keepass::db::GroupId> = group.group_ids().collect();
    for child_id in child_ids {
        if let Some(found) = find_entry_with_path(db, child_id, target, &here) {
            return Some(found);
        }
    }
    None
}

fn build_entry_summary(entry: &keepass::db::EntryRef<'_>) -> EntrySummary {
    let uuid = entry.id().uuid().to_string();
    let title = entry.get_title().unwrap_or("").to_string();
    let username = entry.get("UserName").map(|s| s.to_string());
    let url = entry.get("URL").map(|s| s.to_string());
    let tags = entry.tags.clone();
    let has_totp = entry.get("otp").is_some();
    let modified = entry
        .times
        .last_modification
        .map(|t| t.format("%Y-%m-%dT%H:%M:%SZ").to_string());

    EntrySummary {
        uuid,
        title,
        username,
        url,
        tags,
        has_totp,
        modified,
    }
}

fn build_entry_detail(
    entry_ref: keepass::db::EntryRef<'_>,
    group_path: String,
    db: &keepass::Database,
) -> EntryDetail {
    let summary = build_entry_summary(&entry_ref);
    let entry: &keepass::db::Entry = &*entry_ref;

    let mut fields = Vec::new();
    for (name, value) in &entry.fields {
        let raw = value.get();
        let protected = value.is_protected();
        fields.push(FieldDisplay::from_value(name.clone(), raw, protected));
    }
    // Stable order: standard fields first, then customs alphabetically.
    let standard_order = ["Title", "UserName", "Password", "URL", "Notes"];
    fields.sort_by_key(|f| {
        let n = match f {
            FieldDisplay::Plain { name, .. } | FieldDisplay::Masked { name, .. } => name,
        };
        let idx = standard_order
            .iter()
            .position(|s| *s == n)
            .map(|i| i as i32)
            .unwrap_or(i32::MAX);
        (idx, n.clone())
    });

    let attachments = crate::attachments::collect_attachment_summaries(entry, db);
    let history_count = entry
        .history
        .as_ref()
        .map(|h| h.get_entries().len())
        .unwrap_or(0);

    EntryDetail {
        summary,
        group_path,
        fields,
        attachments,
        history_count,
    }
}

#[cfg(test)]
mod test {
    #[test]
    fn module_compiles() {
        // Real validation lives in tests/wasm_bindgen.rs (Task 17), where we
        // open committed fixtures from a real browser context.
    }
}
