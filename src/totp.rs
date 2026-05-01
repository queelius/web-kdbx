//! TOTP support: parse otpauth:// URIs and compute current codes.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TotpCode {
    pub code: String,
    pub seconds_remaining: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TotpAlgo {
    Sha1,
    Sha256,
    Sha512,
}

#[derive(Debug, Clone)]
pub struct TotpConfig {
    pub secret: Vec<u8>,
    pub period: u32,
    pub digits: u32,
    pub algo: TotpAlgo,
}

impl TotpConfig {
    pub fn parse(uri: &str) -> Option<Self> {
        let url = url::Url::parse(uri).ok()?;
        if url.scheme() != "otpauth" {
            return None;
        }
        if url.host_str() != Some("totp") {
            return None;
        }

        let mut secret = None;
        let mut period = 30u32;
        let mut digits = 6u32;
        let mut algo = TotpAlgo::Sha1;

        for (k, v) in url.query_pairs() {
            match k.as_ref() {
                "secret" => {
                    secret = base32::decode(
                        base32::Alphabet::Rfc4648 { padding: false },
                        v.as_ref(),
                    );
                }
                "period" => {
                    if let Ok(p) = v.parse() {
                        period = p;
                    }
                }
                "digits" => {
                    if let Ok(d) = v.parse() {
                        digits = d;
                    }
                }
                "algorithm" => {
                    algo = match v.to_uppercase().as_str() {
                        "SHA1" => TotpAlgo::Sha1,
                        "SHA256" => TotpAlgo::Sha256,
                        "SHA512" => TotpAlgo::Sha512,
                        _ => TotpAlgo::Sha1,
                    };
                }
                _ => {}
            }
        }

        Some(Self {
            secret: secret?,
            period,
            digits,
            algo,
        })
    }

    pub fn compute_at(&self, now_secs: u64) -> TotpCode {
        let raw = match self.algo {
            TotpAlgo::Sha1 => totp_lite::totp_custom::<totp_lite::Sha1>(
                self.period as u64,
                self.digits,
                &self.secret,
                now_secs,
            ),
            TotpAlgo::Sha256 => totp_lite::totp_custom::<totp_lite::Sha256>(
                self.period as u64,
                self.digits,
                &self.secret,
                now_secs,
            ),
            TotpAlgo::Sha512 => totp_lite::totp_custom::<totp_lite::Sha512>(
                self.period as u64,
                self.digits,
                &self.secret,
                now_secs,
            ),
        };
        let elapsed_in_window = now_secs % self.period as u64;
        let seconds_remaining = (self.period as u64 - elapsed_in_window) as u32;
        TotpCode {
            code: raw,
            seconds_remaining,
        }
    }

    pub fn compute_now(&self) -> TotpCode {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        self.compute_at(now)
    }
}

#[cfg(test)]
mod test {
    use super::*;

    const SAMPLE_URI: &str =
        "otpauth://totp/Example:alice@google.com?secret=JBSWY3DPEHPK3PXP&issuer=Example";

    #[test]
    fn parses_minimal_otpauth_uri() {
        let cfg = TotpConfig::parse(SAMPLE_URI).expect("parse");
        assert!(!cfg.secret.is_empty());
        assert_eq!(cfg.period, 30);
        assert_eq!(cfg.digits, 6);
        assert_eq!(cfg.algo, TotpAlgo::Sha1);
    }

    #[test]
    fn rejects_non_otpauth_uri() {
        assert!(TotpConfig::parse("https://example.com/").is_none());
        assert!(TotpConfig::parse("otpauth://hotp/foo?secret=ABC").is_none());
        assert!(TotpConfig::parse("not a url").is_none());
    }

    #[test]
    fn rejects_missing_secret() {
        assert!(TotpConfig::parse("otpauth://totp/Example?period=30").is_none());
    }

    #[test]
    fn parses_custom_period_and_digits() {
        let uri = "otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP&period=60&digits=8";
        let cfg = TotpConfig::parse(uri).expect("parse");
        assert_eq!(cfg.period, 60);
        assert_eq!(cfg.digits, 8);
    }

    #[test]
    fn parses_sha256_algorithm() {
        let uri = "otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256";
        let cfg = TotpConfig::parse(uri).expect("parse");
        assert_eq!(cfg.algo, TotpAlgo::Sha256);
    }

    #[test]
    fn compute_at_known_vector() {
        let cfg = TotpConfig::parse(
            "otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
        )
        .expect("parse");
        let code = cfg.compute_at(59);
        assert_eq!(code.code, "287082");
    }

    #[test]
    fn seconds_remaining_at_window_boundary() {
        let cfg = TotpConfig::parse("otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP")
            .expect("parse");
        assert_eq!(cfg.compute_at(0).seconds_remaining, 30);
        assert_eq!(cfg.compute_at(29).seconds_remaining, 1);
        assert_eq!(cfg.compute_at(30).seconds_remaining, 30);
    }
}
