//! The Vault: wraps a keepass::Database and exposes browser-shaped accessors.

#[allow(unused_imports)]
use crate::types::*;
#[allow(unused_imports)]
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
