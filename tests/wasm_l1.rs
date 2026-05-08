//! Layer 2 wasm-bindgen tests for the L1 write API and the localStorage
//! round-trip. These run in a real browser via
//! `wasm-pack test --headless --firefox` and exercise the wasm-bindgen
//! surface as the JS layer in `www/` consumes it.
//!
//! Layer 1 (native `cargo test` in `src/vault.rs`) covers the same write
//! paths, but cannot exercise:
//!
//!   - the `JsValue`-based `add_entry(input)` deserialization
//!   - browser-provided APIs like `localStorage` and `btoa/atob`
//!
//! That is what this file is for.

#![cfg(target_arch = "wasm32")]

use serde::{Deserialize, Serialize};
use wasm_bindgen_test::*;
use web_kdbx::Vault;

wasm_bindgen_test_configure!(run_in_browser);

const PASSWORD: &str = "test-password-do-not-use";
const ADD_ENTRY_AFTER: &[u8] = include_bytes!("fixtures/add_entry/after.kdbx");
const ADD_ENTRY_BEFORE: &[u8] = include_bytes!("fixtures/add_entry/before.kdbx");

// Local mirrors of the wasm-bindgen surface's JSON shapes. We re-declare
// them here (rather than depending on the crate-private types) because
// `EntrySummary` and `GroupSummary` in `src/types.rs` are `Serialize`-only
// from the JS side, and the test only needs the fields it asserts on.
#[derive(Debug, Clone, Deserialize)]
struct EntrySummary {
    uuid: String,
    title: String,
}

#[derive(Debug, Deserialize)]
struct GroupSummary {
    uuid: String,
}

#[derive(Debug, Serialize)]
struct EntryInputJs {
    group_uuid: String,
    title: String,
    fields: Vec<FieldInputJs>,
}

#[derive(Debug, Serialize)]
struct FieldInputJs {
    name: String,
    value: String,
    protected: bool,
}

fn root_group_uuid(vault: &Vault) -> String {
    let tree_js = vault.group_tree().expect("group_tree");
    let tree: GroupSummary = serde_wasm_bindgen::from_value(tree_js).expect("decode tree");
    tree.uuid
}

fn entries_under(vault: &Vault, group_uuid: &str) -> Vec<EntrySummary> {
    let entries_js = vault
        .entries_in_group(group_uuid)
        .expect("entries_in_group");
    serde_wasm_bindgen::from_value(entries_js).expect("decode entries")
}

#[wasm_bindgen_test]
fn update_field_changes_in_memory_entry() {
    let mut vault = Vault::open(ADD_ENTRY_AFTER, PASSWORD).expect("open");

    let root_uuid = root_group_uuid(&vault);
    let entries = entries_under(&vault, &root_uuid);
    // The add_entry/after fixture seeds exactly one entry under the root
    // group. Title-agnostic: pick the first one rather than relying on the
    // MANIFEST.md text, which has drifted in the past.
    let entry = entries
        .first()
        .expect("add_entry/after fixture should have one seeded entry")
        .clone();

    let _new_bytes = vault
        .update_field(&entry.uuid, "URL", "https://changed.example.com", false)
        .expect("update_field");

    // Read back the unprotected URL field via the same surface a JS caller
    // would use. Confirms the in-memory database reflects the write without
    // a re-open.
    let url = vault.reveal_field(&entry.uuid, "URL");
    assert_eq!(url.as_deref(), Some("https://changed.example.com"));

    // Title should be untouched by a URL-only update.
    let title_before = entry.title.clone();
    let title_after = vault.reveal_field(&entry.uuid, "Title");
    assert_eq!(title_after.as_deref(), Some(title_before.as_str()));
}

#[wasm_bindgen_test]
fn add_entry_inserts_into_group() {
    let mut vault = Vault::open(ADD_ENTRY_BEFORE, PASSWORD).expect("open");
    let root_uuid = root_group_uuid(&vault);

    // Pre-condition: empty fixture has no entries under root.
    assert!(entries_under(&vault, &root_uuid).is_empty());

    let input = EntryInputJs {
        group_uuid: root_uuid.clone(),
        title: "TestEntry".to_string(),
        fields: vec![
            FieldInputJs {
                name: "UserName".to_string(),
                value: "test-user".to_string(),
                protected: false,
            },
            FieldInputJs {
                name: "Password".to_string(),
                value: "test-pass".to_string(),
                protected: true,
            },
        ],
    };
    let input_js = serde_wasm_bindgen::to_value(&input).expect("encode input");

    let _new_bytes = vault.add_entry(input_js).expect("add_entry");

    let entries = entries_under(&vault, &root_uuid);
    assert!(
        entries.iter().any(|e| e.title == "TestEntry"),
        "added entry should appear in entries_in_group, got: {:?}",
        entries.iter().map(|e| &e.title).collect::<Vec<_>>()
    );
}

#[wasm_bindgen_test]
fn save_to_bytes_returns_reasonable_length() {
    let vault = Vault::open(ADD_ENTRY_AFTER, PASSWORD).expect("open");
    let saved = vault.save_to_bytes().expect("save_to_bytes");
    // Encrypted KDBX 4 files have a header well above 100 bytes even when
    // the database is tiny. The synthetic add_entry fixture is well under
    // 1 MiB; 10 MiB is a generous absurdity ceiling.
    assert!(saved.len() > 100, "saved bytes too small: {}", saved.len());
    assert!(
        saved.len() < 10_000_000,
        "saved bytes absurdly large: {}",
        saved.len()
    );
}

#[wasm_bindgen_test]
fn local_storage_round_trip_preserves_bytes() {
    let storage = web_sys::window()
        .expect("window")
        .local_storage()
        .expect("local_storage call")
        .expect("local_storage available");

    let key = "test:wasm_l1:roundtrip";
    storage.remove_item(key).ok();

    let original_bytes = ADD_ENTRY_AFTER.to_vec();
    let b64 = bytes_to_base64(&original_bytes);
    storage.set_item(key, &b64).expect("setItem");

    let read_b64 = storage
        .get_item(key)
        .expect("getItem")
        .expect("value present");
    let read_bytes = base64_to_bytes(&read_b64);
    assert_eq!(read_bytes, original_bytes, "bytes must round-trip exactly");

    // The round-tripped bytes should still parse as a valid KDBX with the
    // same password. This guards against any subtle base64/UTF-8 mangling
    // that byte-equality alone might miss in adverse encodings.
    let vault = Vault::open(&read_bytes, PASSWORD).expect("re-open after round-trip");
    let _ = vault.name();

    storage.remove_item(key).ok();
}

// Base64 helpers using the browser's `btoa`/`atob`. Matches the encoding
// scheme in `www/storage.js` (each byte mapped 1:1 to a Latin-1 char before
// btoa). Keeping this in-sync with the production helpers means a failure
// here would also catch a mismatch between Rust-side test setup and the JS
// adapter.

fn bytes_to_base64(bytes: &[u8]) -> String {
    let mut binary = String::with_capacity(bytes.len());
    for &b in bytes {
        binary.push(b as char);
    }
    web_sys::window()
        .expect("window")
        .btoa(&binary)
        .expect("btoa")
}

fn base64_to_bytes(b64: &str) -> Vec<u8> {
    let binary = web_sys::window().expect("window").atob(b64).expect("atob");
    binary.chars().map(|c| c as u8).collect()
}
