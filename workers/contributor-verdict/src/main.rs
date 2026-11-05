use rascals_contributor_verdict::{
    evaluate, github_paths, rubric_hash, Evidence, Request, MAX_RESPONSE_BYTES,
};
use std::io::{self, Read, Write};
use std::time::Duration;

fn token() -> Result<Option<String>, String> {
    let value = std::env::var("GITHUB_TOKEN").ok();
    if value.as_ref().is_some_and(|s| {
        s.is_empty() || s.len() > 4096 || !s.bytes().all(|b| (33..=126).contains(&b))
    }) {
        return Err("invalid GitHub credential configuration".into());
    }
    Ok(value)
}
#[cfg(not(target_arch = "wasm32"))]
fn get(url: &str, token: Option<&str>) -> Result<Vec<u8>, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(Duration::from_secs(20))
        .timeout_write(Duration::from_secs(10))
        .redirects(0)
        .build();
    let mut req = agent
        .get(url)
        .set("User-Agent", "Rascals-DAO-verdict/1")
        .set("Accept", "application/vnd.github+json")
        .set("X-GitHub-Api-Version", "2022-11-28");
    if let Some(t) = token {
        req = req.set("Authorization", &format!("Bearer {t}"));
    }
    let resp = req
        .call()
        .map_err(|_| "GitHub request failed; no verdict produced".to_string())?;
    if resp.status() != 200 {
        return Err("unexpected GitHub HTTP status".into());
    }
    let mut bytes = Vec::new();
    resp.into_reader()
        .take(MAX_RESPONSE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "GitHub body read failed")?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err("GitHub response exceeded limit".into());
    }
    Ok(bytes)
}
#[cfg(target_arch = "wasm32")]
fn get(url: &str, token: Option<&str>) -> Result<Vec<u8>, String> {
    let mut req = wasi_http_client::Client::new()
        .get(url)
        .connect_timeout(Duration::from_secs(10))
        .header("User-Agent", "Rascals-DAO-verdict/1")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {t}"));
    }
    let resp = req
        .send()
        .map_err(|_| "GitHub request failed; no verdict produced".to_string())?;
    // wasi-http-client does not follow redirects; all non-200 responses fail closed.
    if resp.status() != 200 {
        return Err("unexpected GitHub HTTP status".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = resp.chunk(16_384).map_err(|_| "GitHub body read failed")? {
        if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err("GitHub response exceeded limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
fn run() -> Result<(), String> {
    if std::env::args().any(|x| x == "--rubric-hash") {
        println!("{}", rubric_hash());
        return Ok(());
    }
    let mut bytes = Vec::new();
    io::stdin()
        .take(16_385)
        .read_to_end(&mut bytes)
        .map_err(|_| "input read failed")?;
    if bytes.len() > 16_384 {
        return Err("request too large".into());
    }
    let r: Request = serde_json::from_slice(&bytes).map_err(|_| "invalid request JSON")?;
    let urls = github_paths(&r)?;
    let secret = token()?;
    let pr = serde_json::from_slice(&get(&urls[0], secret.as_deref())?)
        .map_err(|_| "invalid GitHub PR response")?;
    let files = serde_json::from_slice(&get(&urls[1], secret.as_deref())?)
        .map_err(|_| "invalid GitHub files response")?;
    let checks = serde_json::from_slice(&get(&urls[2], secret.as_deref())?)
        .map_err(|_| "invalid GitHub check-runs response")?;
    let output = evaluate(&r, &Evidence { pr, files, checks })?;
    let output = serde_json::to_vec(&output).map_err(|_| "output encoding failed")?;
    io::stdout()
        .write_all(&output)
        .map_err(|_| "output write failed")?;
    Ok(())
}
fn main() {
    if let Err(e) = run() {
        eprintln!("contributor-verdict: {e}");
        std::process::exit(1);
    }
}
