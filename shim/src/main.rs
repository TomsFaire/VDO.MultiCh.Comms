mod audio;

use anyhow::Result;
use audio::{CHANNEL_COUNT, FRAME_SIZE};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use tracing::info;

#[derive(Debug, Deserialize)]
struct Config {
    audio_device: Option<String>,
    sample_rate: Option<u32>,
}

/// Message format between shim and Electron
#[derive(Debug, Serialize, Deserialize)]
struct AudioFrame {
    channel_id: usize,
    samples: Vec<f32>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let config_path = dirs::home_dir()
        .expect("home dir")
        .join(".vdo-multichan/config.json");

    let cfg: Config = if config_path.exists() {
        let raw = std::fs::read_to_string(&config_path)?;
        serde_json::from_str(&raw).unwrap_or(Config { audio_device: None, sample_rate: None })
    } else {
        Config { audio_device: None, sample_rate: None }
    };

    let device_substr = cfg.audio_device.unwrap_or_default();
    let sample_rate = cfg.sample_rate.unwrap_or(48000);

    info!("Starting audio shim — device: '{device_substr}', rate: {sample_rate}Hz");

    let (mut channels, _streams) = audio::start(&device_substr, sample_rate)?;

    // Share capture consumers and playback producers across WS clients
    let cap_consumers = Arc::new(Mutex::new(channels.capture_consumers));
    let pb_producers = Arc::new(Mutex::new(channels.playback_producers));

    let addr: SocketAddr = "127.0.0.1:9696".parse()?;
    let listener = TcpListener::bind(addr).await?;
    info!("WebSocket server listening on ws://{addr}");

    while let Ok((stream, peer)) = listener.accept().await {
        info!("Client connected: {peer}");
        let cap = cap_consumers.clone();
        let pb = pb_producers.clone();
        tokio::spawn(handle_client(stream, cap, pb));
    }

    Ok(())
}

async fn handle_client(
    stream: TcpStream,
    cap_consumers: Arc<Mutex<Vec<ringbuf::HeapConsumer<f32>>>>,
    pb_producers: Arc<Mutex<Vec<ringbuf::HeapProducer<f32>>>>,
) {
    let ws = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => { tracing::warn!("WS handshake failed: {e}"); return; }
    };

    let (mut sender, mut receiver) = ws.split();

    // Spawn a task that drains capture rings and sends frames to the client
    let cap_task = {
        let cap = cap_consumers.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(
                std::time::Duration::from_millis(10), // 10ms = FRAME_SIZE @ 48kHz
            );
            loop {
                interval.tick().await;
                let frames: Vec<AudioFrame> = {
                    let mut cons = cap.lock().unwrap();
                    (0..CHANNEL_COUNT)
                        .map(|ch| {
                            let mut samples = Vec::with_capacity(FRAME_SIZE);
                            for _ in 0..FRAME_SIZE {
                                samples.push(cons[ch].pop().unwrap_or(0.0));
                            }
                            AudioFrame { channel_id: ch, samples }
                        })
                        .collect()
                };
                for frame in frames {
                    let json = serde_json::to_string(&frame).unwrap();
                    if sender.send(Message::Text(json)).await.is_err() {
                        return;
                    }
                }
            }
        })
    };

    // Receive playback frames from the client and push into playback rings
    while let Some(Ok(msg)) = receiver.next().await {
        if let Message::Text(text) = msg {
            if let Ok(frame) = serde_json::from_str::<AudioFrame>(&text) {
                if frame.channel_id < CHANNEL_COUNT {
                    let mut prods = pb_producers.lock().unwrap();
                    for s in &frame.samples {
                        let _ = prods[frame.channel_id].push(*s);
                    }
                }
            }
        }
    }

    cap_task.abort();
    info!("Client disconnected");
}
