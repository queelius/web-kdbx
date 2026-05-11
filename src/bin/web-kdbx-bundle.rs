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
use clap::{ArgGroup, Parser};
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
#[command(group(ArgGroup::new("vault_target").args(["vault_url", "inline_vault"])))]
struct Args {
    /// Output HTML file (default: dist/web-kdbx.html)
    #[arg(short, long, value_name = "PATH", default_value = "dist/web-kdbx.html")]
    output: PathBuf,

    /// Set <vault-app vault-url="..."> for Mode 1 hosted-vault.
    /// Mutually exclusive with --inline-vault.
    #[arg(long, value_name = "URL", conflicts_with = "inline_vault")]
    vault_url: Option<String>,

    /// Path to a .kdbx file to base64-inline as a data: URL.
    /// Mutually exclusive with --vault-url.
    #[arg(long, value_name = "PATH")]
    inline_vault: Option<PathBuf>,

    /// Override the vault-id attribute.
    /// Default for --inline-vault: derived from SHA-256 of inlined bytes.
    /// Requires --vault-url or --inline-vault.
    #[arg(long, value_name = "ID", requires = "vault_target")]
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

/// Escape a string for safe embedding in a double-quoted HTML attribute value.
/// Handles the five characters that can break out of an attribute or the
/// surrounding tag: `&`, `<`, `>`, `"`, and `'`.
fn attr_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;")
}

/// Build the vault-id from the inlined KDBX bytes when the caller does not
/// supply an explicit id. Returns `inline-<16 hex chars>` (the first 8 bytes
/// of the SHA-256 of the inlined bytes).
pub fn derive_vault_id(bytes: &[u8]) -> String {
    let hash = Sha256::digest(bytes);
    let prefix = u64::from_be_bytes(hash[..8].try_into().expect("8 bytes"));
    format!("inline-{prefix:016x}")
}

/// Build the data: URL string for inlined KDBX bytes.
pub fn kdbx_data_url(bytes: &[u8]) -> String {
    format!("data:application/octet-stream;base64,{}", B64.encode(bytes))
}

/// Build the `<vault-app ...>` element string from the resolved mode
/// parameters. URL and id values are HTML-attribute-escaped so characters like
/// `"`, `<`, `>`, `&`, and `'` cannot break out of the attribute or the tag.
pub fn vault_app_element(vault_url: Option<&str>, vault_id: Option<&str>) -> String {
    match (vault_url, vault_id) {
        (None, _) => "<vault-app></vault-app>".to_string(),
        (Some(url), None) => {
            let url_esc = attr_escape(url);
            format!(r#"<vault-app vault-url="{url_esc}"></vault-app>"#)
        }
        (Some(url), Some(id)) => {
            let url_esc = attr_escape(url);
            let id_esc = attr_escape(id);
            format!(r#"<vault-app vault-url="{url_esc}" vault-id="{id_esc}"></vault-app>"#)
        }
    }
}

/// Strip ES module `import` statements and `export` keywords from a JS source.
///
/// Single-file HTML mode concatenates several JS files into one
/// `<script type="module">` block. Static `import` statements would 404 on
/// their relative paths, so we drop them; their exported names become
/// module-scope declarations once the leading `export ` is removed.
///
///   - Drops static `import ... from '...';` statements (single-line or
///     multi-line, terminated by `;`).
///   - Replaces a leading `export ` token with a single space, preserving
///     indentation.
///
/// Dynamic `import(...)` calls are expressions, not statements, and are
/// untouched. `app.js` (which uses dynamic imports) is not fed to this
/// stripper anyway.
pub fn strip_module_syntax(src: &str) -> String {
    /// True when this line ends a JS statement (ignoring a trailing newline).
    fn ends_statement(line: &str) -> bool {
        line.trim_end_matches(['\n', '\r']).ends_with(';')
    }

    let mut out = String::with_capacity(src.len());
    let mut in_import = false;
    for line in src.split_inclusive('\n') {
        if in_import {
            // Skip lines until we see the import's terminating `;`.
            if ends_statement(line) {
                in_import = false;
            }
            continue;
        }
        let trimmed = line.trim_start();
        if trimmed.starts_with("import ") || trimmed.starts_with("import{") {
            // Static import statement. Single-line if it ends in `;`.
            if !ends_statement(line) {
                in_import = true;
            }
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("export ") {
            // Preserve indentation so prettier-style alignment survives.
            let indent_len = line.len() - trimmed.len();
            out.push_str(&line[..indent_len]);
            out.push_str(rest);
            continue;
        }
        out.push_str(line);
    }
    out
}

/// Render the final HTML document from its constituent parts.
///
/// `storage_js` and `components_js` should already have been passed through
/// `strip_module_syntax`. `wasm_js` is the wasm-pack glue and is concatenated
/// verbatim (its `export` declarations are valid in the same module that
/// later references `Vault` and `__wbg_init`).
///
/// Panics in debug builds if any JS input contains the literal string
/// `</script>`, which would close the wrapping `<script type="module">` tag
/// prematurely and produce broken HTML.
pub fn render_html(
    wasm_b64: &str,
    wasm_js: &str,
    storage_js: &str,
    components_js: &str,
    styles_css: &str,
    body_element: &str,
) -> String {
    debug_assert!(
        !wasm_js.contains("</script>")
            && !storage_js.contains("</script>")
            && !components_js.contains("</script>"),
        "input JS contains literal </script>; would break <script> tag boundary"
    );
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

{storage_js}

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

    if wasm_path.exists() && !is_newer(cargo_toml, &wasm_path) {
        return Ok(());
    }

    println!("Building WASM (wasm-pack build --target web --release)...");
    let status = Command::new("wasm-pack")
        .args(["build", "--target", "web", "--release"])
        .status()
        .context("Failed to run wasm-pack. Is it installed and on PATH?")?;
    if !status.success() {
        bail!("wasm-pack build failed (exit status {status})");
    }
    Ok(())
}

/// True when `a` has a strictly newer mtime than `b`. Missing or unreadable
/// metadata yields the epoch, so a missing `a` is treated as not-newer.
fn is_newer(a: &Path, b: &Path) -> bool {
    fn mtime(path: &Path) -> SystemTime {
        fs::metadata(path)
            .and_then(|m| m.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH)
    }
    mtime(a) > mtime(b)
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

/// Read and assemble `www/components/*.js`.
///
/// `util.js` is concatenated first at outer module scope so its `function el`
/// and `function showToast` are visible to every other component. All other
/// component files have their import-stripped content wrapped in a `{ ... }`
/// block so each file's top-level `const`s are scoped to that block. This
/// prevents the (legitimate) name collisions like the duplicate
/// `CONTROL_CHAR_RE` declarations in `vault-add-entry.js` and
/// `vault-entry-edit.js` from causing a `SyntaxError: Identifier ... has
/// already been declared` at module top level. `customElements.define(...)`
/// works inside a block because it has a global side effect.
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

    // Sort alphabetically so `util.js` comes before `vault-*.js` and the
    // overall order is deterministic.
    entries.sort_by_key(|e| e.file_name());

    let mut combined = String::new();
    for entry in entries {
        let path = entry.path();
        let stripped = strip_module_syntax(&read_to_string(&path)?);
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();
        if name == "util.js" {
            // Outer module scope so `el`, `showToast` are globally visible.
            combined.push_str(&stripped);
        } else {
            // Block-scope each component to isolate its `const`s.
            combined.push_str("{\n");
            combined.push_str(&stripped);
            combined.push_str("\n}\n");
        }
        combined.push('\n');
    }
    Ok(combined)
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

fn main() -> Result<()> {
    let args = Args::parse();

    // (clap enforces --vault-url and --inline-vault are mutually exclusive
    // via conflicts_with on the Args struct, so no runtime check needed.)

    // Build WASM if needed.
    maybe_build_wasm(&args.pkg_dir)?;

    // Read WASM artifacts.
    let wasm_bytes = read_bytes(&args.pkg_dir.join("web_kdbx_bg.wasm"))?;
    let wasm_b64 = B64.encode(&wasm_bytes);
    let wasm_js = read_to_string(&args.pkg_dir.join("web_kdbx.js"))?;

    // Read www/ assets. Note: app.js is intentionally NOT included; its
    // `import init from '../pkg/...'` and `Promise.all([import(...)])` are
    // both redundant in single-file mode (the template already calls
    // __wbg_init with the inlined bytes, and components are concatenated
    // directly so dynamic imports are unneeded).
    //
    // storage.js stays at outer module scope so its functions are visible
    // to every component; only its module syntax needs stripping.
    // read_components already strips module syntax per file and wraps each
    // non-util component in a block scope.
    let storage_js = strip_module_syntax(&read_to_string(&args.www_dir.join("storage.js"))?);
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
        &storage_js,
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
    use keepass::{Database, DatabaseKey};
    use std::io::Cursor;

    #[test]
    fn strip_module_syntax_drops_imports_and_export_keyword() {
        let src = r#"// header comment
import { el } from './util.js';
import {
  hasWorkingCopy,
  loadVaultBytes,
} from '../storage.js';

const X = 1;
export function foo(a) {
  return a + X;
}
export class Bar {
  constructor() { this.y = 2; }
}
"#;
        let out = strip_module_syntax(src);
        // No `import` statements remain.
        assert!(
            !out.contains("import "),
            "stripper left an import in the output:\n{out}"
        );
        // `export ` token is gone but the declarations remain.
        assert!(
            !out.contains("export "),
            "stripper left an export keyword:\n{out}"
        );
        assert!(
            out.contains("function foo("),
            "function foo declaration missing"
        );
        assert!(out.contains("class Bar "), "class Bar declaration missing");
        assert!(out.contains("const X = 1;"), "const declaration missing");
        // Header comment preserved (not part of any import).
        assert!(out.contains("// header comment"), "non-import line dropped");
    }

    #[test]
    fn strip_module_syntax_preserves_dynamic_import() {
        // Dynamic `import(...)` calls are expressions, not statements, and must
        // survive. We don't bundle app.js (which has these), but the stripper
        // must not corrupt code that contains them.
        let src = "const m = await import('./mod.js');\n";
        let out = strip_module_syntax(src);
        assert_eq!(out, src, "dynamic import was incorrectly stripped");
    }

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

    #[test]
    fn vault_app_element_escapes_attributes() {
        // A URL containing `"`, `>`, `<` must not break out of the attribute.
        let out = vault_app_element(Some(r#"foo"><script>"#), None);
        // The raw `>` after the quote should NOT appear as a literal `>` after
        // vault-url="foo.
        assert!(
            !out.contains(r#"vault-url="foo">"#),
            "unescaped `>` in vault-url broke attribute boundary: {out}"
        );
        // The escaped form should be present.
        assert!(
            out.contains(r#"vault-url="foo&quot;&gt;&lt;script&gt;""#),
            "expected escaped attribute value not found: {out}"
        );
        // Safe inputs pass through unmodified.
        let safe = vault_app_element(Some("https://example.com/vault.kdbx"), Some("safe-id"));
        assert!(
            safe.contains(r#"vault-url="https://example.com/vault.kdbx""#),
            "safe URL was unexpectedly mangled: {safe}"
        );
        assert!(
            safe.contains(r#"vault-id="safe-id""#),
            "safe id was unexpectedly mangled: {safe}"
        );
    }

    #[test]
    #[should_panic(expected = "literal </script>")]
    fn render_html_rejects_script_closer() {
        // Any JS input containing literal </script> should trigger the
        // debug_assert in render_html and panic in debug builds.
        render_html(
            "base64data",
            "// wasm-js\n</script>\nalert(1);\n",
            "// storage",
            "// components",
            "body {}",
            "<vault-app></vault-app>",
        );
    }
}
