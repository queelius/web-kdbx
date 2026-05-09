//! `web-kdbx-bundle` -- produce a self-contained single-file HTML from the
//! wasm-pack output and www/ assets.
//!
//! Three modes (determined by flags):
//!
//! 1. Default (no --vault-url, no --inline-vault):
//!    emits `<vault-app></vault-app>`. BYO file picker.
//!
//! 2. --vault-url URL:
//!    emits `<vault-app vault-url="URL"></vault-app>`.
//!    The .kdbx is fetched separately at runtime.
//!
//! 3. --inline-vault PATH:
//!    reads the .kdbx, base64-encodes it into a data: URL, and emits
//!    `<vault-app vault-url="data:..." vault-id="inline-..."></vault-app>`.
//!    The vault-id defaults to `inline-<first 16 hex chars of sha256>`.

use anyhow::{Context, Result, bail};
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use clap::Parser;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::SystemTime,
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

#[derive(Parser, Debug)]
#[command(
    name = "web-kdbx-bundle",
    about = "Produce a self-contained HTML file with the WASM viewer inlined"
)]
struct Args {
    /// Output HTML file (default: dist/web-kdbx.html)
    #[arg(short, long, value_name = "PATH", default_value = "dist/web-kdbx.html")]
    output: PathBuf,

    /// Set <vault-app vault-url="..."> for Mode 1 hosted-vault.
    /// Mutually exclusive with --inline-vault.
    #[arg(long, value_name = "URL")]
    vault_url: Option<String>,

    /// Path to a .kdbx file to base64-inline as a data: URL.
    /// Mutually exclusive with --vault-url.
    #[arg(long, value_name = "PATH")]
    inline_vault: Option<PathBuf>,

    /// Override the vault-id attribute.
    /// Default for --inline-vault: derived from SHA-256 of inlined bytes.
    #[arg(long, value_name = "ID")]
    vault_id: Option<String>,

    /// Where to read wasm-pack output (default: pkg)
    #[arg(long, value_name = "PATH", default_value = "pkg")]
    pkg_dir: PathBuf,

    /// Where to read www/ from (default: www)
    #[arg(long, value_name = "PATH", default_value = "www")]
    www_dir: PathBuf,
}

// ---------------------------------------------------------------------------
// Public, testable primitives
// ---------------------------------------------------------------------------

/// Build the vault-id from the inlined KDBX bytes when the caller does not
/// supply an explicit id. Returns `inline-<16 hex chars>`.
pub fn derive_vault_id(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let hash = hasher.finalize();
    // First 8 bytes = 16 hex chars.
    let hex: String = hash[..8].iter().map(|b| format!("{b:02x}")).collect();
    format!("inline-{hex}")
}

/// Build the data: URL string for inlined KDBX bytes.
pub fn kdbx_data_url(bytes: &[u8]) -> String {
    format!("data:application/octet-stream;base64,{}", B64.encode(bytes))
}

/// Build the `<vault-app ...>` element string from the resolved mode
/// parameters.
pub fn vault_app_element(vault_url: Option<&str>, vault_id: Option<&str>) -> String {
    match (vault_url, vault_id) {
        (None, _) => "<vault-app></vault-app>".to_string(),
        (Some(url), None) => format!(r#"<vault-app vault-url="{url}"></vault-app>"#),
        (Some(url), Some(id)) => {
            format!(r#"<vault-app vault-url="{url}" vault-id="{id}"></vault-app>"#)
        }
    }
}

/// Render the final HTML document from its constituent parts.
pub fn render_html(
    wasm_b64: &str,
    wasm_js: &str,
    app_js: &str,
    components_js: &str,
    styles_css: &str,
    body_element: &str,
) -> String {
    format!(
        r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>web-kdbx</title>
<style>
{styles_css}
</style>
</head>
<body>
{body_element}
<script>
window.__WEB_KDBX_WASM_B64__ = "{wasm_b64}";
</script>
<script type="module">
{wasm_js}

const wasmBytes = Uint8Array.from(atob(window.__WEB_KDBX_WASM_B64__), c => c.charCodeAt(0));
await __wbg_init(wasmBytes);
globalThis.webKdbx = {{ Vault }};

{app_js}

{components_js}
</script>
</body>
</html>
"#
    )
}

// ---------------------------------------------------------------------------
// WASM build helper
// ---------------------------------------------------------------------------

fn maybe_build_wasm(pkg_dir: &Path) -> Result<()> {
    let wasm_path = pkg_dir.join("web_kdbx_bg.wasm");
    let cargo_toml = Path::new("Cargo.toml");

    let wasm_missing = !wasm_path.exists();
    let cargo_newer = if !wasm_missing && cargo_toml.exists() {
        let cargo_mtime = fs::metadata(cargo_toml)
            .and_then(|m| m.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        let wasm_mtime = fs::metadata(&wasm_path)
            .and_then(|m| m.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        cargo_mtime > wasm_mtime
    } else {
        false
    };

    if wasm_missing || cargo_newer {
        println!("Building WASM (wasm-pack build --target web --release)...");
        let status = Command::new("wasm-pack")
            .args(["build", "--target", "web", "--release"])
            .status()
            .context("Failed to run wasm-pack. Is it installed and on PATH?")?;
        if !status.success() {
            bail!("wasm-pack build failed (exit status {status})");
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Asset reading helpers
// ---------------------------------------------------------------------------

fn read_to_string(path: &Path) -> Result<String> {
    fs::read_to_string(path).with_context(|| format!("Failed to read {}", path.display()))
}

fn read_bytes(path: &Path) -> Result<Vec<u8>> {
    fs::read(path).with_context(|| format!("Failed to read {}", path.display()))
}

fn read_components(components_dir: &Path) -> Result<String> {
    let mut entries: Vec<_> = fs::read_dir(components_dir)
        .with_context(|| format!("Failed to read {}", components_dir.display()))?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("js"))
        })
        .collect();

    // Sort alphabetically to match shell glob order.
    entries.sort_by_key(|e| e.file_name());

    let mut combined = String::new();
    for entry in entries {
        let content = read_to_string(&entry.path())?;
        combined.push_str(&content);
        combined.push('\n');
    }
    Ok(combined)
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

fn main() -> Result<()> {
    let args = Args::parse();

    // Validate mutually exclusive flags.
    if args.vault_url.is_some() && args.inline_vault.is_some() {
        bail!("--vault-url and --inline-vault are mutually exclusive");
    }

    // Build WASM if needed.
    maybe_build_wasm(&args.pkg_dir)?;

    // Read WASM artifacts.
    let wasm_bytes = read_bytes(&args.pkg_dir.join("web_kdbx_bg.wasm"))?;
    let wasm_b64 = B64.encode(&wasm_bytes);
    let wasm_js = read_to_string(&args.pkg_dir.join("web_kdbx.js"))?;

    // Read www/ assets.
    let app_js = read_to_string(&args.www_dir.join("app.js"))?;
    let styles_css = read_to_string(&args.www_dir.join("styles.css"))?;
    let components_js = read_components(&args.www_dir.join("components"))?;

    // Resolve mode.
    let (resolved_url, resolved_id): (Option<String>, Option<String>) =
        if let Some(ref kdbx_path) = args.inline_vault {
            let kdbx_bytes = read_bytes(kdbx_path)?;
            let vault_id = args
                .vault_id
                .clone()
                .unwrap_or_else(|| derive_vault_id(&kdbx_bytes));
            let data_url = kdbx_data_url(&kdbx_bytes);
            (Some(data_url), Some(vault_id))
        } else if let Some(ref url) = args.vault_url {
            (Some(url.clone()), args.vault_id.clone())
        } else {
            (None, None)
        };

    let body_element = vault_app_element(resolved_url.as_deref(), resolved_id.as_deref());

    let html = render_html(
        &wasm_b64,
        &wasm_js,
        &app_js,
        &components_js,
        &styles_css,
        &body_element,
    );

    // Write output.
    if let Some(parent) = args.output.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create output directory {}", parent.display()))?;
    }
    fs::write(&args.output, html.as_bytes())
        .with_context(|| format!("Failed to write {}", args.output.display()))?;

    println!("Wrote {}", args.output.display());
    println!("Size: {} bytes", html.len());

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use keepass::{Database, DatabaseKey};
    use std::io::Cursor;

    #[test]
    fn inline_vault_data_url_decrypts() {
        // Paths are relative to crate root (cargo test sets cwd to crate root).
        // The "empty" fixture uses before.kdbx (an empty KDBX 4 database).
        let kdbx_path = Path::new("tests/fixtures/empty/before.kdbx");
        let kdbx_bytes = fs::read(kdbx_path)
            .expect("tests/fixtures/empty/before.kdbx must exist; re-read MANIFEST.md");

        // --- vault-id derivation ---
        let vault_id = derive_vault_id(&kdbx_bytes);
        assert!(
            vault_id.starts_with("inline-"),
            "vault_id must start with 'inline-': got {vault_id}"
        );
        // 'inline-' prefix (7 chars) + 16 hex chars = 23 chars total.
        assert_eq!(vault_id.len(), 23, "unexpected vault_id length: {vault_id}");

        // --- data URL construction ---
        let data_url = kdbx_data_url(&kdbx_bytes);
        assert!(
            data_url.starts_with("data:application/octet-stream;base64,"),
            "unexpected data_url prefix: {data_url}"
        );

        // --- round-trip: extract base64, decode, compare bytes ---
        let b64_part = data_url
            .strip_prefix("data:application/octet-stream;base64,")
            .expect("prefix must be present");
        let decoded = B64.decode(b64_part).expect("base64 decode must succeed");
        assert_eq!(
            decoded, kdbx_bytes,
            "decoded bytes must match original file bytes"
        );

        // --- keepass decrypt round-trip ---
        let key = DatabaseKey::new().with_password("test-password-do-not-use");
        let mut cursor = Cursor::new(&decoded);
        Database::open(&mut cursor, key)
            .expect("keepass::Database::open must succeed with the test password");
    }
}
