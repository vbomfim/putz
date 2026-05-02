//! Local audio stream proxy — serves remote streams from localhost
//! so the Web Audio AnalyserNode works without CORS restrictions.
//! Also extracts ICY metadata (real bitrate, station name).

use std::sync::OnceLock;
use tokio::sync::oneshot;

static PROXY_PORT: OnceLock<u16> = OnceLock::new();

/// Start the proxy server on a random port.
pub fn start_proxy() -> u16 {
    if let Some(&port) = PROXY_PORT.get() {
        return port;
    }
    let (tx, rx) = oneshot::channel::<u16>();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio runtime");
        rt.block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                .await
                .expect("bind");
            let port = listener.local_addr().unwrap().port();
            let _ = tx.send(port);
            loop {
                if let Ok((stream, _)) = listener.accept().await {
                    tokio::spawn(handle_connection(stream));
                }
            }
        });
    });
    let port = rx.blocking_recv().expect("proxy port");
    PROXY_PORT.set(port).ok();
    port
}

async fn handle_connection(mut stream: tokio::net::TcpStream) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut buf = vec![0u8; 4096];
    let n = match stream.read(&mut buf).await {
        Ok(n) if n > 0 => n,
        _ => return,
    };
    let request = String::from_utf8_lossy(&buf[..n]);
    let url = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|path| path.strip_prefix("/proxy?url="))
        .map(|u| urlencoding::decode(u).unwrap_or_default().to_string());

    let url = match url {
        Some(u) if !u.is_empty() => u,
        _ => {
            let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n").await;
            return;
        }
    };

    // Request with ICY metadata support
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .unwrap_or_default();
    let res = match client.get(&url).header("Icy-MetaData", "1").send().await {
        Ok(r) => r,
        Err(_) => {
            let _ = stream.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n").await;
            return;
        }
    };

    // Extract ICY headers for real bitrate
    let icy_br = res
        .headers()
        .get("icy-br")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let icy_name = res
        .headers()
        .get("icy-name")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let content_type = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("audio/mpeg")
        .to_string();

    let header = format!(
        "HTTP/1.1 200 OK\r\n\
         Content-Type: {content_type}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Expose-Headers: X-Icy-Br, X-Icy-Name\r\n\
         X-Icy-Br: {icy_br}\r\n\
         X-Icy-Name: {icy_name}\r\n\
         Connection: close\r\n\r\n"
    );
    if stream.write_all(header.as_bytes()).await.is_err() {
        return;
    }

    use futures_util::StreamExt;
    let mut body = res.bytes_stream();
    while let Some(chunk) = body.next().await {
        match chunk {
            Ok(bytes) if !bytes.is_empty() => {
                if stream.write_all(&bytes).await.is_err() {
                    break;
                }
            }
            _ => break,
        }
    }
}

/// IPC: get the proxy base URL.
#[tauri::command]
pub fn audio_proxy_url() -> String {
    let port = start_proxy();
    format!("http://127.0.0.1:{}/proxy?url=", port)
}
