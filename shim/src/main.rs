mod audio;

use anyhow::Result;
use audio::CHANNEL_COUNT;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message;
use tracing::info;

#[derive(Debug, Deserialize)]
struct Config {
    input_device: Option<String>,
    output_device: Option<String>,
    sample_rate: Option<u32>,
}

/// Outbound: audio PCM frame for one channel
#[derive(Debug, Serialize, Deserialize)]
struct AudioFrame {
    channel_id: usize,
    samples: Vec<f32>,
}

/// Outbound: device lists sent on connect
#[derive(Debug, Serialize)]
struct DeviceEntry {
    name: String,
    channels: u16,
}

#[derive(Debug, Serialize)]
struct DevicesMsg {
    #[serde(rename = "type")]
    msg_type: &'static str,
    input_devices: Vec<DeviceEntry>,
    output_devices: Vec<DeviceEntry>,
}

/// Inbound: control messages from Electron
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ControlMsg {
    ListDevices,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let config_path = dirs::home_dir()
        .expect("home dir")
        .join(".vdo-multichan/config.json");

    let cfg: Config = if config_path.exists() {
        let raw = std::fs::read_to_string(&config_path)?;
        serde_json::from_str(&raw).unwrap_or(Config { input_device: None, output_device: None, sample_rate: None })
    } else {
        Config { input_device: None, output_device: None, sample_rate: None }
    };

    let input_device = cfg.input_device.unwrap_or_default();
    let output_device = cfg.output_device.unwrap_or_default();
    let sample_rate = cfg.sample_rate.unwrap_or(48000);

    info!("Starting audio shim — in: '{input_device}', out: '{output_device}', rate: {sample_rate}Hz");

    let (mut channels, _streams) = audio::start(&input_device, &output_device, sample_rate)?;

    let frame_tx = channels.frame_tx;
    let pb_producers = Arc::new(Mutex::new(channels.playback_producers));

    let addr: SocketAddr = "127.0.0.1:9696".parse()?;
    let listener = TcpListener::bind(addr).await?;
    info!("WebSocket server listening on ws://{addr}");

    while let Ok((stream, peer)) = listener.accept().await {
        info!("Client connected: {peer}");
        let pb = pb_producers.clone();
        let frame_rx = frame_tx.subscribe();
        tokio::spawn(handle_client(stream, frame_rx, pb));
    }

    Ok(())
}

async fn handle_client(
    stream: TcpStream,
    mut frame_rx: broadcast::Receiver<Vec<u8>>,
    pb_producers: Arc<Mutex<Vec<ringbuf::HeapProducer<f32>>>>,
) {
    let ws = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => { tracing::warn!("WS handshake failed: {e}"); return; }
    };

    let (sender, mut receiver) = ws.split();
    let sender = Arc::new(tokio::sync::Mutex::new(sender));

    // Send device list immediately on connect
    let devices_msg = serde_json::to_string(&DevicesMsg {
        msg_type: "devices",
        input_devices: audio::list_input_devices().into_iter().map(|d| DeviceEntry { name: d.name, channels: d.channels }).collect(),
        output_devices: audio::list_output_devices().into_iter().map(|d| DeviceEntry { name: d.name, channels: d.channels }).collect(),
    }).unwrap();
    if sender.lock().await.send(Message::Text(devices_msg)).await.is_err() {
        return;
    }

    // Forward audio frames as they arrive from the CPAL broadcast channel.
    // No timer — dispatch is driven by the hardware audio clock via the CPAL callback.
    let cap_task = {
        let sender = sender.clone();
        tokio::spawn(async move {
            loop {
                match frame_rx.recv().await {
                    Ok(buf) => {
                        if sender.lock().await.send(Message::Binary(buf.into())).await.is_err() {
                            return;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("WS client lagged, dropped {n} audio frames");
                    }
                    Err(broadcast::error::RecvError::Closed) => return,
                }
            }
        })
    };

    // Receive messages from Electron: audio playback frames or control
    while let Some(Ok(msg)) = receiver.next().await {
        if let Message::Text(text) = msg {
            // Try audio frame first (has channel_id + samples), then control
            if let Ok(frame) = serde_json::from_str::<AudioFrame>(&text) {
                if frame.channel_id < CHANNEL_COUNT {
                    let mut prods = pb_producers.lock().unwrap();
                    for s in &frame.samples {
                        let _ = prods[frame.channel_id].push(*s);
                    }
                }
            } else if let Ok(ctrl) = serde_json::from_str::<ControlMsg>(&text) {
                match ctrl {
                    ControlMsg::ListDevices => {
                        let to_entries = |devs: Vec<audio::DeviceInfo>| devs.into_iter().map(|d| DeviceEntry { name: d.name, channels: d.channels }).collect::<Vec<_>>();
                        let reply = serde_json::to_string(&DevicesMsg {
                            msg_type: "devices",
                            input_devices: to_entries(audio::list_input_devices()),
                            output_devices: to_entries(audio::list_output_devices()),
                        }).unwrap();
                        if sender.lock().await.send(Message::Text(reply)).await.is_err() {
                            break;
                        }
                    }
                }
            }
        }
    }

    cap_task.abort();
    info!("Client disconnected");
}
