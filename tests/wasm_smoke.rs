//! Browser-side smoke tests for the wasm-bindgen surface.
//!
//! Run via: wasm-pack test --headless --firefox

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

const PASSWORD: &str = "test-password-do-not-use";
const ADD_ENTRY_AFTER: &[u8] = include_bytes!("fixtures/add_entry/after.kdbx");
const EMPTY_BEFORE: &[u8] = include_bytes!("fixtures/empty/before.kdbx");

#[wasm_bindgen_test]
fn open_with_correct_password_succeeds() {
    let v = web_kdbx::Vault::open(ADD_ENTRY_AFTER, PASSWORD);
    assert!(v.is_ok(), "open should succeed with correct password");
}

#[wasm_bindgen_test]
fn open_with_wrong_password_fails() {
    let result = web_kdbx::Vault::open(ADD_ENTRY_AFTER, "wrong-password");
    assert!(result.is_err());
}

#[wasm_bindgen_test]
fn open_with_corrupt_file_fails() {
    let bad_bytes = b"this is not a KDBX file";
    let result = web_kdbx::Vault::open(bad_bytes, PASSWORD);
    assert!(result.is_err());
}

#[wasm_bindgen_test]
fn empty_database_group_tree_does_not_error() {
    let v = web_kdbx::Vault::open(EMPTY_BEFORE, PASSWORD).expect("open");
    let _ = v.group_tree().expect("group_tree");
}

#[wasm_bindgen_test]
fn search_with_empty_query_returns_empty_array() {
    let v = web_kdbx::Vault::open(ADD_ENTRY_AFTER, PASSWORD).expect("open");
    let result = v.search("").expect("search");
    let len = js_sys::Array::from(&result).length();
    assert_eq!(len, 0);
}
