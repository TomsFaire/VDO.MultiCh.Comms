use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, StreamConfig};
use ringbuf::{HeapConsumer, HeapProducer, HeapRb};
use std::sync::Arc;

pub const CHANNEL_COUNT: usize = 4;
pub const FRAME_SIZE: usize = 480; // 10ms @ 48kHz

pub struct AudioChannels {
    /// PCM from hardware → shim WS sender (one ring per channel)
    pub capture_consumers: Vec<HeapConsumer<f32>>,
    /// PCM from shim WS receiver → hardware (one ring per channel)
    pub playback_producers: Vec<HeapProducer<f32>>,
}

pub struct AudioStreams {
    _input: cpal::Stream,
    _output: cpal::Stream,
}

pub fn start(device_substr: &str, sample_rate: u32) -> Result<(AudioChannels, AudioStreams)> {
    let host = cpal::default_host();
    let device = find_device(&host, device_substr)?;

    let config = StreamConfig {
        channels: CHANNEL_COUNT as u16,
        sample_rate: cpal::SampleRate(sample_rate),
        buffer_size: cpal::BufferSize::Fixed(FRAME_SIZE as u32 * CHANNEL_COUNT as u32),
    };

    // capture rings: hardware → WS
    let mut cap_producers: Vec<HeapProducer<f32>> = Vec::new();
    let mut cap_consumers: Vec<HeapConsumer<f32>> = Vec::new();
    // playback rings: WS → hardware
    let mut pb_producers: Vec<HeapProducer<f32>> = Vec::new();
    let mut pb_consumers: Vec<HeapConsumer<f32>> = Vec::new();

    for _ in 0..CHANNEL_COUNT {
        let rb = HeapRb::<f32>::new(FRAME_SIZE * 16);
        let (p, c) = rb.split();
        cap_producers.push(p);
        cap_consumers.push(c);

        let rb = HeapRb::<f32>::new(FRAME_SIZE * 16);
        let (p, c) = rb.split();
        pb_producers.push(p);
        pb_consumers.push(c);
    }

    let cap_producers = Arc::new(std::sync::Mutex::new(cap_producers));
    let pb_consumers = Arc::new(std::sync::Mutex::new(pb_consumers));

    let cap_producers_clone = cap_producers.clone();
    let input_stream = device
        .build_input_stream(
            &config,
            move |data: &[f32], _| {
                let mut prods = cap_producers_clone.lock().unwrap();
                // interleaved: sample[ch0, ch1, ch2, ch3, ch0, ...]
                for (i, &sample) in data.iter().enumerate() {
                    let ch = i % CHANNEL_COUNT;
                    let _ = prods[ch].push(sample);
                }
            },
            |e| tracing::error!("input stream error: {e}"),
            None,
        )
        .context("build input stream")?;

    let pb_consumers_clone = pb_consumers.clone();
    let output_stream = device
        .build_output_stream(
            &config,
            move |data: &mut [f32], _| {
                let mut cons = pb_consumers_clone.lock().unwrap();
                for (i, sample) in data.iter_mut().enumerate() {
                    let ch = i % CHANNEL_COUNT;
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
        AudioChannels {
            capture_consumers: cap_consumers,
            playback_producers: {
                // unwrap the mutex — single owner from here
                Arc::try_unwrap(pb_producers)
                    .unwrap()
                    .into_inner()
                    .unwrap()
            },
        },
        AudioStreams {
            _input: input_stream,
            _output: output_stream,
        },
    ))
}

fn find_device(host: &cpal::Host, substr: &str) -> Result<Device> {
    if substr.is_empty() {
        return host.default_input_device().context("no default input device");
    }
    let substr_lower = substr.to_lowercase();
    host.input_devices()
        .context("enumerate input devices")?
        .find(|d| {
            d.name()
                .map(|n| n.to_lowercase().contains(&substr_lower))
                .unwrap_or(false)
        })
        .context(format!("no device matching '{substr}'"))
}
