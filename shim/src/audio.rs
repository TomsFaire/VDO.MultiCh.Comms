use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, StreamConfig};
use ringbuf::{HeapConsumer, HeapProducer, HeapRb};
use std::sync::Arc;
use tokio::sync::broadcast;

pub const CHANNEL_COUNT: usize = 4;
pub const FRAME_SIZE: usize = 480; // 10ms @ 48kHz

// Broadcast capacity: 64 frames = ~640ms. Slow receivers get dropped frames rather
// than blocking the CPAL callback.
pub const BROADCAST_CAP: usize = 64;

pub struct AudioChannels {
    // Receives packed multi-channel audio frames built directly in the CPAL callback.
    // Each WebSocket client subscribes independently — no shared consumer contention.
    pub frame_tx: broadcast::Sender<Vec<u8>>,
    pub playback_producers: Vec<HeapProducer<f32>>,
}

pub struct AudioStreams {
    _input: cpal::Stream,
    _output: cpal::Stream,
}

pub struct DeviceInfo {
    pub name: String,
    pub channels: u16,
}

fn probe_max_input_channels(device: &cpal::Device, sample_rate: u32) -> u16 {
    for &count in &[32u16, 16, 8, 4, 2, 1] {
        let config = cpal::StreamConfig {
            channels: count,
            sample_rate: cpal::SampleRate(sample_rate),
            buffer_size: cpal::BufferSize::Default,
        };
        if device.build_input_stream(&config, |_: &[f32], _| {}, |_| {}, None).is_ok() {
            return count;
        }
    }
    1
}

fn probe_max_output_channels(device: &cpal::Device, sample_rate: u32) -> u16 {
    for &count in &[32u16, 16, 8, 4, 2, 1] {
        let config = cpal::StreamConfig {
            channels: count,
            sample_rate: cpal::SampleRate(sample_rate),
            buffer_size: cpal::BufferSize::Default,
        };
        if device.build_output_stream(&config, |_: &mut [f32], _| {}, |_| {}, None).is_ok() {
            return count;
        }
    }
    1
}

fn max_input_channels(device: &cpal::Device) -> u16 {
    let from_configs = device.supported_input_configs()
        .ok()
        .and_then(|cfgs| cfgs.map(|c| c.channels()).max())
        .unwrap_or(0);
    if from_configs > 2 { return from_configs; }
    probe_max_input_channels(device, 48000)
}

fn max_output_channels(device: &cpal::Device) -> u16 {
    let from_configs = device.supported_output_configs()
        .ok()
        .and_then(|cfgs| cfgs.map(|c| c.channels()).max())
        .unwrap_or(0);
    if from_configs > 2 { return from_configs; }
    probe_max_output_channels(device, 48000)
}

pub fn list_input_devices() -> Vec<DeviceInfo> {
    let host = cpal::default_host();
    host.input_devices()
        .map(|devs| devs.filter_map(|d| {
            Some(DeviceInfo { channels: max_input_channels(&d), name: d.name().ok()? })
        }).collect())
        .unwrap_or_default()
}

pub fn list_output_devices() -> Vec<DeviceInfo> {
    let host = cpal::default_host();
    host.output_devices()
        .map(|devs| devs.filter_map(|d| {
            Some(DeviceInfo { channels: max_output_channels(&d), name: d.name().ok()? })
        }).collect())
        .unwrap_or_default()
}

pub fn start(input_substr: &str, output_substr: &str, sample_rate: u32) -> Result<(AudioChannels, AudioStreams)> {
    let host = cpal::default_host();
    let input_dev = find_input_device(&host, input_substr)?;
    let output_dev = find_output_device(&host, output_substr)?;

    let in_ch = (max_input_channels(&input_dev) as usize).min(CHANNEL_COUNT).max(1);
    let out_ch = (max_output_channels(&output_dev) as usize).min(CHANNEL_COUNT).max(1);
    tracing::info!("opening input with {in_ch} ch, output with {out_ch} ch");

    let in_config = StreamConfig {
        channels: in_ch as u16,
        sample_rate: cpal::SampleRate(sample_rate),
        buffer_size: cpal::BufferSize::Default,
    };
    let out_config = StreamConfig {
        channels: out_ch as u16,
        sample_rate: cpal::SampleRate(sample_rate),
        buffer_size: cpal::BufferSize::Default,
    };

    // Playback path: ring buffers fed from WebSocket, drained by CPAL output callback.
    let mut pb_producers: Vec<HeapProducer<f32>> = Vec::new();
    let mut pb_consumers: Vec<HeapConsumer<f32>> = Vec::new();
    for _ in 0..CHANNEL_COUNT {
        let (p, c) = HeapRb::<f32>::new(FRAME_SIZE * 16).split();
        pb_producers.push(p);
        pb_consumers.push(c);
    }
    let pb_consumers = Arc::new(std::sync::Mutex::new(pb_consumers));

    // Capture path: CPAL callback accumulates samples, packs a complete multi-channel
    // frame when FRAME_SIZE samples per channel are ready, broadcasts to all WS clients.
    // Each client gets its own receiver — no shared consumer contention.
    let (frame_tx, _) = broadcast::channel::<Vec<u8>>(BROADCAST_CAP);
    let frame_tx_clone = frame_tx.clone();

    let logged_once = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let logged_once_clone = logged_once.clone();

    // Per-channel accumulator — pre-allocated to avoid malloc in the audio callback.
    // Max 2 frames of headroom per channel is enough since we drain when full.
    let mut accum: Vec<Vec<f32>> = (0..in_ch)
        .map(|_| { let mut v = Vec::new(); v.reserve(FRAME_SIZE * 2); v })
        .collect();

    let input_stream = input_dev
        .build_input_stream(
            &in_config,
            move |data: &[f32], _| {
                if !logged_once_clone.swap(true, std::sync::atomic::Ordering::Relaxed) {
                    tracing::info!(
                        "CPAL input callback: {} interleaved samples = {} per channel",
                        data.len(), data.len() / in_ch
                    );
                }
                // Deinterleave into per-channel accumulators.
                for (i, &s) in data.iter().enumerate() {
                    let ch = i % in_ch;
                    accum[ch].push(s);
                }
                // Emit complete frames as they become available.
                // All channels must have >= FRAME_SIZE samples before we emit.
                while accum[0].len() >= FRAME_SIZE {
                    // Pack: [ch: u32 LE][n: u32 LE][samples: f32[] LE] × in_ch
                    let mut buf = Vec::with_capacity(in_ch * (8 + FRAME_SIZE * 4));
                    for ch in 0..in_ch {
                        buf.extend_from_slice(&(ch as u32).to_le_bytes());
                        buf.extend_from_slice(&(FRAME_SIZE as u32).to_le_bytes());
                        for &s in &accum[ch][..FRAME_SIZE] {
                            buf.extend_from_slice(&s.to_le_bytes());
                        }
                        accum[ch].drain(..FRAME_SIZE);
                    }
                    // send() is non-async and non-blocking. Err means no receivers yet — fine.
                    let _ = frame_tx_clone.send(buf);
                }
            },
            |e| tracing::error!("input stream error: {e}"),
            None,
        )
        .context("build input stream")?;

    let pb_consumers_clone = pb_consumers.clone();
    let output_stream = output_dev
        .build_output_stream(
            &out_config,
            move |data: &mut [f32], _| {
                let mut cons = pb_consumers_clone.lock().unwrap();
                for (i, sample) in data.iter_mut().enumerate() {
                    let ch = i % out_ch;
                    *sample = cons[ch].pop().unwrap_or(0.0);
                }
            },
            |e| tracing::error!("output stream error: {e}"),
            None,
        )
        .context("build output stream")?;

    input_stream.play().context("play input stream")?;
    output_stream.play().context("play output stream")?;

    Ok((
        AudioChannels { frame_tx, playback_producers: pb_producers },
        AudioStreams { _input: input_stream, _output: output_stream },
    ))
}

fn name_matches(cpal_name: &str, query: &str) -> bool {
    let a = cpal_name.to_lowercase();
    let b = query.to_lowercase();
    a.contains(&b) || b.contains(&a)
}

fn find_input_device(host: &cpal::Host, substr: &str) -> Result<Device> {
    if substr.is_empty() {
        return host.default_input_device().context("no default input device");
    }
    let devs: Vec<Device> = host.input_devices().context("enumerate input devices")?.collect();
    let names: Vec<String> = devs.iter().filter_map(|d| d.name().ok()).collect();
    tracing::info!("available input devices: {:?}", names);
    devs.into_iter()
        .find(|d| d.name().map(|n| name_matches(&n, substr)).unwrap_or(false))
        .context(format!("no input device matching '{substr}' — available: {names:?}"))
}

fn find_output_device(host: &cpal::Host, substr: &str) -> Result<Device> {
    if substr.is_empty() {
        return host.default_output_device().context("no default output device");
    }
    let devs: Vec<Device> = host.output_devices().context("enumerate output devices")?.collect();
    let names: Vec<String> = devs.iter().filter_map(|d| d.name().ok()).collect();
    tracing::info!("available output devices: {:?}", names);
    if let Some(dev) = devs.into_iter().find(|d| d.name().map(|n| name_matches(&n, substr)).unwrap_or(false)) {
        return Ok(dev);
    }
    if let Some(def) = host.default_output_device() {
        let def_name = def.name().unwrap_or_default();
        tracing::warn!("output '{substr}' not found — falling back to default '{def_name}'");
        return Ok(def);
    }
    anyhow::bail!("no output device matching '{substr}' — available: {names:?}")
}
