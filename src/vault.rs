//! The Vault: wraps a keepass::Database and exposes browser-shaped accessors.

use crate::types::*;
use serde_wasm_bindgen::to_value;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Vault {
    db: keepass::Database,
    key: keepass::DatabaseKey,
}

#[wasm_bindgen]
impl Vault {
    /// Open a KDBX file. On any error returns a JsError with the conflated
    /// message "Wrong password or corrupt file." This conflation is
    /// deliberate per the spec (security: don't leak whether a file is
    /// valid KDBX before the password is known).
    ///
    /// The `DatabaseKey` is retained on the `Vault` so subsequent writes
    /// (`update_field`, `add_entry`) can re-encrypt via `save_to_bytes`
    /// without re-prompting for the master password.
    #[wasm_bindgen(constructor)]
    pub fn open(bytes: &[u8], password: &str) -> Result<Vault, JsError> {
        let key = keepass::DatabaseKey::new().with_password(password);
        let mut reader = std::io::Cursor::new(bytes);
        let db = keepass::Database::open(&mut reader, key.clone())
            .map_err(|_| JsError::new("Wrong password or corrupt file."))?;
        Ok(Vault { db, key })
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

    pub fn search(&self, query: &str) -> Result<JsValue, JsError> {
        let results = crate::search::search(&self.db, query);
        to_value(&results).map_err(|e| JsError::new(&e.to_string()))
    }

    /// Return plaintext for a single field. Returns None if not found.
    pub fn reveal_field(&self, entry_uuid: &str, field_name: &str) -> Option<String> {
        let entry_ref = self.find_entry(entry_uuid)?;
        let entry: &keepass::db::Entry = &*entry_ref;
        let value = entry.fields.get(field_name)?;
        Some(value.get().to_string())
    }

    /// Compute the current TOTP code. Returns null on the JS side if the
    /// entry has no `otp` field or the value is not a parseable
    /// otpauth:// URI.
    pub fn totp(&self, entry_uuid: &str) -> Result<JsValue, JsError> {
        let entry_ref = match self.find_entry(entry_uuid) {
            Some(e) => e,
            None => {
                return to_value(&Option::<crate::totp::TotpCode>::None)
                    .map_err(|e| JsError::new(&e.to_string()));
            }
        };
        let entry: &keepass::db::Entry = &*entry_ref;

        let uri = match entry.fields.get("otp").map(|v| v.get()) {
            Some(s) => s.to_string(),
            None => {
                return to_value(&Option::<crate::totp::TotpCode>::None)
                    .map_err(|e| JsError::new(&e.to_string()));
            }
        };

        let cfg = match crate::totp::TotpConfig::parse(&uri) {
            Some(c) => c,
            None => {
                return to_value(&Option::<crate::totp::TotpCode>::None)
                    .map_err(|e| JsError::new(&e.to_string()));
            }
        };

        let code = cfg.compute_now();
        to_value(&Some(code)).map_err(|e| JsError::new(&e.to_string()))
    }

    pub fn entry(&self, entry_uuid: &str) -> Result<JsValue, JsError> {
        let target = match uuid::Uuid::parse_str(entry_uuid) {
            Ok(u) => u,
            Err(_) => return to_value(&Option::<EntryDetail>::None)
                .map_err(|e| JsError::new(&e.to_string())),
        };

        let root_id = self.db.root().id();
        let detail = find_entry_with_path(&self.db, root_id, target, "")
            .map(|(entry_ref, group_path)| build_entry_detail(entry_ref, group_path));

        to_value(&detail).map_err(|e| JsError::new(&e.to_string()))
    }

    /// Update a single field on an existing entry. Returns the freshly
    /// re-encrypted KDBX bytes for the JS layer to persist into
    /// localStorage. The in-memory database is also updated, so subsequent
    /// reads on this `Vault` reflect the change without a re-open.
    pub fn update_field(
        &mut self,
        entry_uuid: &str,
        field_name: &str,
        value: &str,
        protected: bool,
    ) -> Result<Vec<u8>, JsError> {
        let target =
            uuid::Uuid::parse_str(entry_uuid).map_err(|_| JsError::new("Invalid entry UUID"))?;
        let entry_id = self
            .db
            .iter_all_entries()
            .find(|er| er.id().uuid() == target)
            .map(|er| er.id())
            .ok_or_else(|| JsError::new("Entry not found"))?;

        let mut entry_mut = self
            .db
            .entry_mut(entry_id)
            .ok_or_else(|| JsError::new("Entry not found"))?;
        let field_name_owned = field_name.to_string();
        let value_owned = value.to_string();
        entry_mut.edit(|e| {
            let v = if protected {
                keepass::db::Value::protected(value_owned)
            } else {
                keepass::db::Value::unprotected(value_owned)
            };
            e.set(field_name_owned, v);
        });

        self.save_to_bytes()
    }

    /// Add a new entry to the specified group. Returns the freshly
    /// re-encrypted KDBX bytes for the JS layer to persist. The new entry's
    /// UUID is auto-generated by keepass; callers can find it via
    /// subsequent reads on the returned bytes (or on `self`).
    pub fn add_entry(&mut self, input: JsValue) -> Result<Vec<u8>, JsError> {
        let input: EntryInput = serde_wasm_bindgen::from_value(input)
            .map_err(|e| JsError::new(&format!("Invalid input: {}", e)))?;
        self.add_entry_inner(input)
    }

    /// Re-encrypt the in-memory database to KDBX bytes using the retained
    /// `DatabaseKey` from `open`. JS persists these to
    /// `localStorage[vault-id]` as the working copy.
    pub fn save_to_bytes(&self) -> Result<Vec<u8>, JsError> {
        let mut buf = Vec::new();
        self.db
            .save(&mut buf, self.key.clone())
            .map_err(|e| JsError::new(&format!("Save failed: {}", e)))?;
        Ok(buf)
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

    /// Inner implementation of `add_entry` operating on a typed
    /// `EntryInput`. Kept separate from the wasm-bindgen wrapper so native
    /// tests can exercise the write path without going through `JsValue`.
    pub(crate) fn add_entry_inner(&mut self, input: EntryInput) -> Result<Vec<u8>, JsError> {
        let target = uuid::Uuid::parse_str(&input.group_uuid)
            .map_err(|_| JsError::new("Invalid group UUID"))?;
        let group_id = self
            .db
            .iter_all_groups()
            .find(|gr| gr.id().uuid() == target)
            .map(|gr| gr.id())
            .ok_or_else(|| JsError::new("Group not found"))?;

        let mut group_mut = self
            .db
            .group_mut(group_id)
            .ok_or_else(|| JsError::new("Group not found"))?;
        let title = input.title;
        let fields = input.fields;
        group_mut.add_entry().edit(|e| {
            e.set_unprotected(keepass::db::fields::TITLE, title);
            for f in fields {
                let v = if f.protected {
                    keepass::db::Value::protected(f.value)
                } else {
                    keepass::db::Value::unprotected(f.value)
                };
                e.set(f.name, v);
            }
        });

        self.save_to_bytes()
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

fn build_entry_detail(entry_ref: keepass::db::EntryRef<'_>, group_path: String) -> EntryDetail {
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

    let attachments = crate::attachments::collect_attachment_summaries(&entry_ref);
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
    use super::*;
    use keepass::{Database, DatabaseKey};

    const TEST_PASSWORD: &str = "demopass";

    /// Build a tiny in-memory KDBX, save it, then open via `Vault::open`.
    /// Returns the `Vault` and the UUID of the single seeded entry as a string.
    fn build_test_vault() -> (Vault, String) {
        let mut db = Database::new();
        let entry_uuid;
        {
            let mut root = db.root_mut();
            let mut entry = root.add_entry();
            entry_uuid = entry.id().uuid().to_string();
            entry.edit(|e| {
                e.set_unprotected(keepass::db::fields::TITLE, "Test Entry");
                e.set_unprotected(keepass::db::fields::USERNAME, "alice");
                e.set_protected(keepass::db::fields::PASSWORD, "hunter2");
                e.set_unprotected(keepass::db::fields::URL, "https://old.example.com");
            });
        }

        let mut buf = Vec::new();
        db.save(&mut buf, DatabaseKey::new().with_password(TEST_PASSWORD))
            .expect("save fixture");

        let vault = Vault::open(&buf, TEST_PASSWORD).expect("open fixture");
        (vault, entry_uuid)
    }

    /// Re-open KDBX bytes via the keepass crate directly. Returns the parsed
    /// `Database` so tests can introspect fields without going through wasm
    /// glue.
    fn reopen(bytes: &[u8]) -> Database {
        let mut reader = std::io::Cursor::new(bytes);
        Database::open(&mut reader, DatabaseKey::new().with_password(TEST_PASSWORD))
            .expect("reopen")
    }

    fn find_entry_ref<'a>(db: &'a Database, target_uuid: &str) -> keepass::db::EntryRef<'a> {
        let target = uuid::Uuid::parse_str(target_uuid).expect("parse uuid");
        db.iter_all_entries()
            .find(|er| er.id().uuid() == target)
            .expect("find entry")
    }

    #[test]
    fn module_compiles() {
        // Real validation lives in tests/wasm_bindgen.rs (Task 17), where we
        // open committed fixtures from a real browser context.
    }

    #[test]
    fn save_to_bytes_roundtrip() {
        let (vault, entry_uuid) = build_test_vault();
        let bytes = vault.save_to_bytes().expect("save_to_bytes");
        assert!(!bytes.is_empty(), "saved KDBX must not be empty");

        let reopened = reopen(&bytes);
        let entry = find_entry_ref(&reopened, &entry_uuid);
        assert_eq!(entry.get_title(), Some("Test Entry"));
        assert_eq!(entry.get("UserName"), Some("alice"));
        assert_eq!(entry.get("URL"), Some("https://old.example.com"));
    }

    #[test]
    fn update_field_persists() {
        let (mut vault, entry_uuid) = build_test_vault();
        let bytes = vault
            .update_field(&entry_uuid, "URL", "https://example.com", false)
            .expect("update_field");

        let reopened = reopen(&bytes);
        let entry = find_entry_ref(&reopened, &entry_uuid);
        assert_eq!(entry.get("URL"), Some("https://example.com"));
        // Other fields unchanged.
        assert_eq!(entry.get("UserName"), Some("alice"));
    }

    // Note: error-path tests for update_field/add_entry (invalid UUID,
    // missing entry, missing group) are not exercised at this layer because
    // constructing a `JsError` panics on non-wasm targets ("cannot call
    // wasm-bindgen imported functions on non-wasm targets"). Layer 2
    // wasm-bindgen tests (Task 13) will cover those paths in a real browser
    // context.

    #[test]
    fn add_entry_persists() {
        let (mut vault, _entry_uuid) = build_test_vault();
        let root_uuid = vault.db.root().id().uuid().to_string();

        let input = EntryInput {
            group_uuid: root_uuid,
            title: "Added Entry".to_string(),
            fields: vec![
                FieldInput {
                    name: "UserName".to_string(),
                    value: "bob".to_string(),
                    protected: false,
                },
                FieldInput {
                    name: "Password".to_string(),
                    value: "s3cret".to_string(),
                    protected: true,
                },
            ],
        };

        let bytes = vault.add_entry_inner(input).expect("add_entry_inner");
        let reopened = reopen(&bytes);

        let added = reopened
            .iter_all_entries()
            .find(|er| er.get_title() == Some("Added Entry"))
            .expect("added entry visible after reopen");
        assert_eq!(added.get("UserName"), Some("bob"));
        assert_eq!(added.get("Password"), Some("s3cret"));
        let pw = added.fields.get("Password").expect("password field");
        assert!(pw.is_protected(), "Password should be a protected value");
    }

    #[test]
    fn protected_field_roundtrips() {
        let (mut vault, entry_uuid) = build_test_vault();
        let bytes = vault
            .update_field(&entry_uuid, "Password", "s3cret", true)
            .expect("update_field protected");

        let reopened = reopen(&bytes);
        let entry_ref = find_entry_ref(&reopened, &entry_uuid);
        let pw = entry_ref.fields.get("Password").expect("password field");
        assert!(pw.is_protected(), "Password should remain protected");
        assert_eq!(pw.get(), "s3cret");
    }

    #[test]
    fn protection_toggle() {
        let (mut vault, entry_uuid) = build_test_vault();

        // First write: unprotected.
        let _ = vault
            .update_field(&entry_uuid, "Notes", "plain note", false)
            .expect("write unprotected");

        // Second write: same field, now protected.
        let bytes = vault
            .update_field(&entry_uuid, "Notes", "secret note", true)
            .expect("write protected");

        let reopened = reopen(&bytes);
        let entry_ref = find_entry_ref(&reopened, &entry_uuid);
        let notes = entry_ref.fields.get("Notes").expect("notes field");
        assert!(notes.is_protected(), "Notes should now be protected");
        assert_eq!(notes.get(), "secret note");
    }
}
