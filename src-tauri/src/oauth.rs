//! Loopback server for the Google sign-in redirect.
//!
//! Google doesn't accept custom URI schemes as redirect targets for desktop
//! clients, so the app has to listen on a local port and let the browser
//! redirect back to it. This is deliberately small and dependency-free: it
//! accepts exactly one request, reads the first line, replies with a short
//! page, and hands the query string to the frontend.
//!
//! It never sees a token. The frontend takes the authorization code from the
//! query string and posts it to our backend, which does the exchange with
//! Google using a client secret that never ships inside this binary.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Abandoned sign-ins shouldn't leave a thread parked forever.
const TIMEOUT: Duration = Duration::from_secs(180);

const DONE_PAGE: &str = r#"<!doctype html>
<html lang="no"><head><meta charset="utf-8"><title>Drop Involve</title></head>
<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#003F46;color:#F8F5EC;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;text-align:center">
<div><p style="font-size:17px;margin:0 0 8px">Du er logget inn.</p>
<p style="font-size:15px;margin:0;color:rgba(248,245,236,0.6)">Du kan lukke dette vinduet og gå tilbake til appen.</p></div>
</body></html>"#;

#[derive(Default)]
pub struct OauthState {
    listener: Mutex<Option<TcpListener>>,
}

/// Binds a port and returns it, so the caller can build a redirect URI before
/// opening the browser. Port 0 lets the OS pick a free one.
#[tauri::command]
pub fn oauth_start(state: tauri::State<OauthState>) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    *state
        .listener
        .lock()
        .map_err(|_| "Kunne ikke starte innlogging.".to_string())? = Some(listener);

    Ok(port)
}

/// Waits for the browser redirect and returns the request target, e.g.
/// `/?code=4/0Ab...&scope=...`.
#[tauri::command]
pub async fn oauth_wait(state: tauri::State<'_, OauthState>) -> Result<String, String> {
    let listener = {
        let mut guard = state
            .listener
            .lock()
            .map_err(|_| "Kunne ikke starte innlogging.".to_string())?;
        guard
            .take()
            .ok_or_else(|| "Innlogging er ikke startet.".to_string())?
    };

    tauri::async_runtime::spawn_blocking(move || accept_redirect(listener))
        .await
        .map_err(|e| e.to_string())?
}

fn accept_redirect(listener: TcpListener) -> Result<String, String> {
    let deadline = Instant::now() + TIMEOUT;

    loop {
        if Instant::now() > deadline {
            return Err("Tidsavbrudd. Prøv å logge inn på nytt.".into());
        }

        match listener.accept() {
            Ok((mut stream, _addr)) => {
                stream.set_nonblocking(false).ok();

                let mut reader = BufReader::new(
                    stream.try_clone().map_err(|e| e.to_string())?,
                );
                let mut request_line = String::new();
                reader
                    .read_line(&mut request_line)
                    .map_err(|e| e.to_string())?;

                // "GET /?code=... HTTP/1.1" -> "/?code=..."
                let target = request_line
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("")
                    .to_string();

                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    DONE_PAGE.len(),
                    DONE_PAGE
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();

                if target.is_empty() {
                    return Err("Fikk ingen svardata fra Google.".into());
                }

                return Ok(target);
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}
