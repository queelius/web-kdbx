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

#[cfg(test)]
mod test {
    #[test]
    fn module_compiles() {
        // Real validation lives in tests/wasm_bindgen.rs (Task 17), where we
        // open committed fixtures from a real browser context.
    }
}
