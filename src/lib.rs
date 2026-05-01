//! web-kdbx: browser-side KDBX viewer.
//!
//! Layer 0 of the *-kdbx ecosystem.

pub mod attachments;
pub mod totp;
pub mod types;
pub mod vault;

pub use vault::Vault;
