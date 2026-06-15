#include <napi.h>
#include <CoreAudio/CoreAudio.h>
#include <vector>
#include <string>
#include <atomic>
#include <mutex>
#include <cstring>
#include <algorithm>
#include <cmath>
#include <cstdio>

static const int kMaxChannels = 16;
static const size_t kRingCap = 192000;
static const size_t kMaxLatency = 4800; // drop beyond ~100 ms @ 48 kHz
static const Float64 kSourceSampleRate = 48000.0;

// ── helpers ──────────────────────────────────────────────────────────────────

static std::string getStringProperty(AudioDeviceID id,
                                     AudioObjectPropertySelector sel,
                                     AudioObjectPropertyScope scope = kAudioObjectPropertyScopeGlobal) {
  CFStringRef str = nullptr;
  UInt32 size = sizeof(str);
  AudioObjectPropertyAddress addr = { sel, scope, kAudioObjectPropertyElementMain };
  if (AudioObjectGetPropertyData(id, &addr, 0, nullptr, &size, &str) != noErr || !str)
    return "";
  char buf[512];
  CFStringGetCString(str, buf, sizeof(buf), kCFStringEncodingUTF8);
  CFRelease(str);
  return std::string(buf);
}

static int getChannelCount(AudioDeviceID id, AudioObjectPropertyScope scope) {
  AudioObjectPropertyAddress addr = {
    kAudioDevicePropertyStreamConfiguration, scope, kAudioObjectPropertyElementMain
  };
  UInt32 size = 0;
  if (AudioObjectGetPropertyDataSize(id, &addr, 0, nullptr, &size) != noErr || size == 0)
    return 0;
  std::vector<uint8_t> buf(size);
  auto* list = reinterpret_cast<AudioBufferList*>(buf.data());
  if (AudioObjectGetPropertyData(id, &addr, 0, nullptr, &size, list) != noErr)
    return 0;
  int total = 0;
  for (UInt32 i = 0; i < list->mNumberBuffers; i++)
    total += list->mBuffers[i].mNumberChannels;
  return total;
}

static AudioDeviceID findDeviceByUID(const std::string& uid) {
  if (uid.empty()) return kAudioDeviceUnknown;
  AudioObjectPropertyAddress addr = {
    kAudioHardwarePropertyDevices,
    kAudioObjectPropertyScopeGlobal,
    kAudioObjectPropertyElementMain
  };
  UInt32 size = 0;
  AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &addr, 0, nullptr, &size);
  std::vector<AudioDeviceID> ids(size / sizeof(AudioDeviceID));
  AudioObjectGetPropertyData(kAudioObjectSystemObject, &addr, 0, nullptr, &size, ids.data());
  for (auto devId : ids) {
    if (getStringProperty(devId, kAudioDevicePropertyDeviceUID) == uid)
      return devId;
  }
  return kAudioDeviceUnknown;
}

static AudioDeviceID getDefaultOutputDeviceId() {
  AudioDeviceID id = kAudioDeviceUnknown;
  AudioObjectPropertyAddress addr = {
    kAudioHardwarePropertyDefaultOutputDevice,
    kAudioObjectPropertyScopeGlobal,
    kAudioObjectPropertyElementMain
  };
  UInt32 size = sizeof(id);
  AudioObjectGetPropertyData(kAudioObjectSystemObject, &addr, 0, nullptr, &size, &id);
  return id;
}

static Float64 getNominalSampleRate(AudioDeviceID id) {
  Float64 rate = kSourceSampleRate;
  AudioObjectPropertyAddress addr = {
    kAudioDevicePropertyNominalSampleRate,
    kAudioObjectPropertyScopeGlobal,
    kAudioObjectPropertyElementMain
  };
  UInt32 size = sizeof(rate);
  if (AudioObjectGetPropertyData(id, &addr, 0, nullptr, &size, &rate) != noErr || rate <= 0)
    return kSourceSampleRate;
  return rate;
}

static Float64 configureDeviceSampleRate(AudioDeviceID id) {
  Float64 want = kSourceSampleRate;
  AudioObjectPropertyAddress addr = {
    kAudioDevicePropertyNominalSampleRate,
    kAudioObjectPropertyScopeGlobal,
    kAudioObjectPropertyElementMain
  };
  AudioObjectSetPropertyData(id, &addr, 0, nullptr, sizeof(want), &want);
  return getNominalSampleRate(id);
}

// ── audio engine state ────────────────────────────────────────────────────────

struct AudioEngine {
  AudioDeviceID            deviceId   = kAudioDeviceUnknown;
  AudioDeviceIOProcID      procId     = nullptr;
  std::string              uid;

  // capture
  std::atomic<bool>        capRunning{false};
  int                      capChannels = 0;
  Napi::ThreadSafeFunction capTsfn;

  // playback rings
  std::atomic<bool>        pbRunning{false};
  int                      pbChannels = 0;
  Float64                  deviceSampleRate = kSourceSampleRate;
  std::vector<float>       rings[kMaxChannels];
  size_t                   head[kMaxChannels]{};
  size_t                   tail[kMaxChannels]{};
  size_t                   size[kMaxChannels]{};
  std::mutex               pbMutex;

  // test tone injection
  std::atomic<int>         testChannel{-1};
  std::atomic<int>         testSamplesLeft{0};
  double                   testPhase{0.0};
};

static AudioEngine g_in;
static AudioEngine g_out;

static void dispatchCaptureSamples(int ch, std::vector<float> samples) {
  if (!g_in.capRunning || samples.empty() || !g_in.capTsfn) return;
  g_in.capTsfn.NonBlockingCall(
    [ch, s = std::move(samples)](Napi::Env env, Napi::Function cb) {
      auto arr = Napi::Float32Array::New(env, s.size());
      std::copy(s.begin(), s.end(), arr.Data());
      cb.Call({ Napi::Number::New(env, ch), arr });
    }
  );
}

static void processInputBuffer(const AudioBufferList* inData, int maxChannels) {
  if (!inData) return;

  if (inData->mNumberBuffers == 1 && inData->mBuffers[0].mNumberChannels > 1) {
    const auto& buf = inData->mBuffers[0];
    int nCh = (int)buf.mNumberChannels;
    int frameCount = (int)(buf.mDataByteSize / (sizeof(float) * nCh));
    const float* data = static_cast<const float*>(buf.mData);
    if (!data || frameCount <= 0) return;
    for (int ch = 0; ch < maxChannels && ch < nCh; ch++) {
      std::vector<float> samples(frameCount);
      for (int i = 0; i < frameCount; i++)
        samples[i] = data[i * nCh + ch];
      dispatchCaptureSamples(ch, std::move(samples));
    }
    return;
  }

  int nBufs = (int)inData->mNumberBuffers;
  for (int ch = 0; ch < maxChannels && ch < nBufs; ch++) {
    const auto& buf = inData->mBuffers[ch];
    int n = (int)(buf.mDataByteSize / sizeof(float));
    if (!buf.mData || n <= 0) continue;
    std::vector<float> samples(static_cast<const float*>(buf.mData),
                               static_cast<const float*>(buf.mData) + n);
    dispatchCaptureSamples(ch, std::move(samples));
  }
}

static float popRawSample(AudioEngine& eng, int ch) {
  if (ch < 0 || ch >= kMaxChannels || eng.size[ch] == 0) return 0.f;
  float v = eng.rings[ch][eng.head[ch]];
  eng.head[ch] = (eng.head[ch] + 1) % kRingCap;
  eng.size[ch]--;
  return v;
}

static float popPlaybackSample(AudioEngine& eng, int ch) {
  int testCh = eng.testChannel.load();
  if (testCh == ch) {
    int left = eng.testSamplesLeft.load();
    if (left > 0) {
      eng.testSamplesLeft = left - 1;
      eng.testPhase += 2.0 * M_PI * 440.0 / eng.deviceSampleRate;
      return (float)(0.2 * sin(eng.testPhase));
    }
    eng.testChannel = -1;
  }

  if (eng.size[ch] == 0) return 0.f;
  return popRawSample(eng, ch);
}

static void fillOutputBuffer(AudioEngine& eng, AudioBufferList* outData) {
  if (!outData) return;
  std::lock_guard<std::mutex> lock(eng.pbMutex);

  if (outData->mNumberBuffers == 1 && outData->mBuffers[0].mNumberChannels > 1) {
    const auto& buf = outData->mBuffers[0];
    int nCh = (int)buf.mNumberChannels;
    int frames = (int)(buf.mDataByteSize / (sizeof(float) * nCh));
    float* out = static_cast<float*>(buf.mData);
    if (!out || frames <= 0) return;
    for (int i = 0; i < frames; i++) {
      for (int ch = 0; ch < nCh; ch++) {
        float s = (ch < eng.pbChannels) ? popPlaybackSample(eng, ch) : 0.f;
        out[i * nCh + ch] = s;
      }
    }
    return;
  }

  int nBufs = (int)outData->mNumberBuffers;
  for (int ch = 0; ch < eng.pbChannels && ch < nBufs; ch++) {
    auto& buf = outData->mBuffers[ch];
    int frames = (int)(buf.mDataByteSize / sizeof(float));
    float* out = static_cast<float*>(buf.mData);
    if (!out) continue;
    for (int i = 0; i < frames; i++)
      out[i] = popPlaybackSample(eng, ch);
  }
}

static OSStatus InputHalCallback(AudioDeviceID,
                                  const AudioTimeStamp*,
                                  const AudioBufferList* inData,
                                  const AudioTimeStamp*,
                                  AudioBufferList*,
                                  const AudioTimeStamp*,
                                  void*) {
  if (g_in.capRunning) processInputBuffer(inData, g_in.capChannels);
  return noErr;
}

static OSStatus OutputHalCallback(AudioDeviceID,
                                   const AudioTimeStamp*,
                                   const AudioBufferList*,
                                   const AudioTimeStamp*,
                                   AudioBufferList* outData,
                                   const AudioTimeStamp*,
                                   void*) {
  if (g_out.pbRunning) fillOutputBuffer(g_out, outData);
  return noErr;
}

static OSStatus DuplexHalCallback(AudioDeviceID,
                                   const AudioTimeStamp*,
                                   const AudioBufferList* inData,
                                   const AudioTimeStamp*,
                                   AudioBufferList* outData,
                                   const AudioTimeStamp*,
                                   void*) {
  if (g_in.capRunning) processInputBuffer(inData, g_in.capChannels);
  if (g_in.pbRunning) fillOutputBuffer(g_in, outData);
  return noErr;
}

static void stopEngine(AudioEngine& eng) {
  if (eng.procId) {
    AudioDeviceStop(eng.deviceId, eng.procId);
    AudioDeviceDestroyIOProcID(eng.deviceId, eng.procId);
    eng.procId = nullptr;
  }
  eng.capRunning = false;
  eng.pbRunning = false;
  if (eng.capTsfn) eng.capTsfn.Release();
  eng.deviceId = kAudioDeviceUnknown;
  eng.uid.clear();
}

static void resetPlaybackState(AudioEngine& eng) {
  std::lock_guard<std::mutex> lock(eng.pbMutex);
  for (int i = 0; i < kMaxChannels; i++) {
    eng.rings[i].assign(kRingCap, 0.f);
    eng.head[i] = eng.tail[i] = eng.size[i] = 0;
  }
}

static void clearPlaybackChannel(AudioEngine& eng, int ch) {
  if (ch < 0 || ch >= kMaxChannels) return;
  std::lock_guard<std::mutex> lock(eng.pbMutex);
  eng.head[ch] = eng.tail[ch] = eng.size[ch] = 0;
}

static void pushPlaybackRing(AudioEngine& eng, int ch, const float* data, size_t n, float gain) {
  if (ch < 0 || ch >= kMaxChannels || !data || n == 0) return;
  std::lock_guard<std::mutex> lock(eng.pbMutex);
  if (eng.rings[ch].empty()) eng.rings[ch].resize(kRingCap, 0.f);
  for (size_t i = 0; i < n; i++) {
    while (eng.size[ch] >= kRingCap) {
      eng.head[ch] = (eng.head[ch] + 1) % kRingCap;
      eng.size[ch]--;
    }
    eng.rings[ch][eng.tail[ch]] = data[i] * gain;
    eng.tail[ch] = (eng.tail[ch] + 1) % kRingCap;
    eng.size[ch]++;
  }
  while (eng.size[ch] > kMaxLatency) {
    eng.head[ch] = (eng.head[ch] + 1) % kRingCap;
    eng.size[ch]--;
  }
}

static AudioEngine* playbackEngine() {
  if (g_in.pbRunning) return &g_in;
  if (g_out.pbRunning) return &g_out;
  return nullptr;
}

// ── N-API exports ─────────────────────────────────────────────────────────────

static Napi::Value ListDevices(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  AudioObjectPropertyAddress addr = {
    kAudioHardwarePropertyDevices,
    kAudioObjectPropertyScopeGlobal,
    kAudioObjectPropertyElementMain
  };
  UInt32 size = 0;
  AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &addr, 0, nullptr, &size);
  std::vector<AudioDeviceID> ids(size / sizeof(AudioDeviceID));
  AudioObjectGetPropertyData(kAudioObjectSystemObject, &addr, 0, nullptr, &size, ids.data());

  Napi::Array result = Napi::Array::New(env);
  uint32_t idx = 0;
  for (auto devId : ids) {
    int inCh  = getChannelCount(devId, kAudioDevicePropertyScopeInput);
    int outCh = getChannelCount(devId, kAudioDevicePropertyScopeOutput);
    if (inCh == 0 && outCh == 0) continue;
    Napi::Object dev = Napi::Object::New(env);
    dev.Set("name",        Napi::String::New(env, getStringProperty(devId, kAudioDevicePropertyDeviceNameCFString)));
    dev.Set("uid",         Napi::String::New(env, getStringProperty(devId, kAudioDevicePropertyDeviceUID)));
    dev.Set("inChannels",  Napi::Number::New(env, inCh));
    dev.Set("outChannels", Napi::Number::New(env, outCh));
    result[idx++] = dev;
  }
  return result;
}

static Napi::Value GetDefaultOutputDeviceUID(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  AudioDeviceID id = getDefaultOutputDeviceId();
  if (id == kAudioDeviceUnknown) return Napi::String::New(env, "");
  return Napi::String::New(env, getStringProperty(id, kAudioDevicePropertyDeviceUID));
}

static Napi::Value SetDefaultOutputDevice(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string uid = info[0].As<Napi::String>();
  if (uid.empty()) return Napi::Boolean::New(env, true);
  AudioDeviceID devId = findDeviceByUID(uid);
  if (devId == kAudioDeviceUnknown) {
    Napi::Error::New(env, "output device not found: " + uid).ThrowAsJavaScriptException();
    return env.Undefined();
  }
  AudioObjectPropertyAddress addr = {
    kAudioHardwarePropertyDefaultOutputDevice,
    kAudioObjectPropertyScopeGlobal,
    kAudioObjectPropertyElementMain
  };
  OSStatus err = AudioObjectSetPropertyData(
    kAudioObjectSystemObject, &addr, 0, nullptr, sizeof(devId), &devId);
  if (err != noErr) {
    Napi::Error::New(env, "failed to set default output device").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return Napi::Boolean::New(env, true);
}

static void stopAllEngines() {
  stopEngine(g_in);
  stopEngine(g_out);
}

static Napi::Value startAudioImpl(Napi::Env env,
                                  const std::string& capUid,
                                  int capCh,
                                  const std::string& pbUid,
                                  int pbCh,
                                  Napi::Function capCb) {
  stopAllEngines();

  const bool wantCap = !capUid.empty() && capCh > 0;
  const bool wantPb  = !pbUid.empty() && pbCh > 0;
  if (!wantCap && !wantPb) return env.Undefined();

  if (wantCap && wantPb && capUid == pbUid) {
    AudioDeviceID devId = findDeviceByUID(capUid);
    if (devId == kAudioDeviceUnknown) {
      Napi::Error::New(env, "device not found: " + capUid).ThrowAsJavaScriptException();
      return env.Undefined();
    }
    int detIn  = getChannelCount(devId, kAudioDevicePropertyScopeInput);
    int detOut = getChannelCount(devId, kAudioDevicePropertyScopeOutput);
    if (detIn > 0 && capCh > detIn) capCh = detIn;
    if (detOut > 0 && pbCh > detOut) pbCh = detOut;

    g_in.deviceSampleRate = configureDeviceSampleRate(devId);
    fprintf(stderr, "CoreAudio duplex rate: %.0f Hz (source %.0f Hz)\n",
            g_in.deviceSampleRate, kSourceSampleRate);

    g_in.deviceId = devId;
    g_in.uid = capUid;
    g_in.capChannels = capCh;
    g_in.pbChannels = pbCh;
    if (wantCap)
      g_in.capTsfn = Napi::ThreadSafeFunction::New(env, capCb, "CoreAudioCapture", 0, 1);
    resetPlaybackState(g_in);
    g_in.capRunning = wantCap;
    g_in.pbRunning = wantPb;

    OSStatus err = AudioDeviceCreateIOProcID(devId, DuplexHalCallback, nullptr, &g_in.procId);
    if (err != noErr) {
      stopEngine(g_in);
      Napi::Error::New(env, "duplex AudioDeviceCreateIOProcID failed").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    err = AudioDeviceStart(devId, g_in.procId);
    if (err != noErr) {
      stopEngine(g_in);
      Napi::Error::New(env, "duplex AudioDeviceStart failed").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    return env.Undefined();
  }

  if (wantCap) {
    AudioDeviceID devId = findDeviceByUID(capUid);
    if (devId == kAudioDeviceUnknown) {
      Napi::Error::New(env, "capture device not found: " + capUid).ThrowAsJavaScriptException();
      return env.Undefined();
    }
    int detIn = getChannelCount(devId, kAudioDevicePropertyScopeInput);
    if (detIn > 0 && capCh > detIn) capCh = detIn;
    configureDeviceSampleRate(devId);
    g_in.deviceId = devId;
    g_in.uid = capUid;
    g_in.capChannels = capCh;
    g_in.capTsfn = Napi::ThreadSafeFunction::New(env, capCb, "CoreAudioCapture", 0, 1);
    g_in.capRunning = true;
    OSStatus err = AudioDeviceCreateIOProcID(devId, InputHalCallback, nullptr, &g_in.procId);
    if (err != noErr) { stopEngine(g_in); Napi::Error::New(env, "capture create failed").ThrowAsJavaScriptException(); return env.Undefined(); }
    err = AudioDeviceStart(devId, g_in.procId);
    if (err != noErr) { stopEngine(g_in); Napi::Error::New(env, "capture start failed").ThrowAsJavaScriptException(); return env.Undefined(); }
  }

  if (wantPb) {
    AudioDeviceID devId = findDeviceByUID(pbUid);
    if (devId == kAudioDeviceUnknown) {
      Napi::Error::New(env, "playback device not found: " + pbUid).ThrowAsJavaScriptException();
      return env.Undefined();
    }
    int detOut = getChannelCount(devId, kAudioDevicePropertyScopeOutput);
    if (detOut > 0 && pbCh > detOut) pbCh = detOut;
    g_out.deviceSampleRate = configureDeviceSampleRate(devId);
    g_out.deviceId = devId;
    g_out.uid = pbUid;
    g_out.pbChannels = pbCh;
    resetPlaybackState(g_out);
    g_out.pbRunning = true;
    OSStatus err = AudioDeviceCreateIOProcID(devId, OutputHalCallback, nullptr, &g_out.procId);
    if (err != noErr) { stopEngine(g_out); Napi::Error::New(env, "playback create failed").ThrowAsJavaScriptException(); return env.Undefined(); }
    err = AudioDeviceStart(devId, g_out.procId);
    if (err != noErr) { stopEngine(g_out); Napi::Error::New(env, "playback start failed").ThrowAsJavaScriptException(); return env.Undefined(); }
  }

  return env.Undefined();
}

static Napi::Value StopAudio(const Napi::CallbackInfo& info) {
  stopAllEngines();
  return info.Env().Undefined();
}

// startAudio(captureUid, capCh, playbackUid, pbCh, captureCallback)
static Napi::Value StartAudio(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  return startAudioImpl(env,
    info[0].As<Napi::String>(),
    info[1].As<Napi::Number>().Int32Value(),
    info[2].As<Napi::String>(),
    info[3].As<Napi::Number>().Int32Value(),
    info[4].As<Napi::Function>());
}

static Napi::Value ClearPlaybackChannel(const Napi::CallbackInfo& info) {
  AudioEngine* eng = playbackEngine();
  if (!eng) return info.Env().Undefined();
  int ch = info[0].As<Napi::Number>().Int32Value();
  clearPlaybackChannel(*eng, ch);
  return info.Env().Undefined();
}

static Napi::Value PushPlaybackSamples(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  AudioEngine* eng = playbackEngine();
  if (!eng) return env.Undefined();

  int ch = info[0].As<Napi::Number>().Int32Value();
  float gain = info.Length() > 2 ? info[2].As<Napi::Number>().FloatValue() : 1.f;

  if (info[1].IsTypedArray()) {
    auto arr = info[1].As<Napi::Float32Array>();
    size_t n = arr.ElementLength();
    if (n > 0) pushPlaybackRing(*eng, ch, arr.Data(), n, gain);
  } else if (info[1].IsBuffer()) {
    auto buf = info[1].As<Napi::Buffer<uint8_t>>();
    size_t nFloats = buf.Length() / sizeof(float);
    if (nFloats > 0) {
      const float* data = reinterpret_cast<const float*>(buf.Data());
      pushPlaybackRing(*eng, ch, data, nFloats, gain);
    }
  } else if (info[1].IsArray()) {
    auto arr = info[1].As<Napi::Array>();
    std::vector<float> tmp(arr.Length());
    for (uint32_t i = 0; i < arr.Length(); i++)
      tmp[i] = arr.Get(i).As<Napi::Number>().FloatValue();
    pushPlaybackRing(*eng, ch, tmp.data(), tmp.size(), gain);
  }
  return env.Undefined();
}

static Napi::Value PlayTestTone(const Napi::CallbackInfo& info) {
  AudioEngine* eng = playbackEngine();
  if (!eng) return info.Env().Undefined();
  int ch = info[0].As<Napi::Number>().Int32Value();
  int ms = info.Length() > 1 ? info[1].As<Napi::Number>().Int32Value() : 500;
  eng->testChannel = ch;
  eng->testPhase = 0.0;
  eng->testSamplesLeft = (int)(eng->deviceSampleRate * ms / 1000.0);
  return info.Env().Undefined();
}

static Napi::Value StartCapture(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  return startAudioImpl(env,
    info[0].As<Napi::String>(),
    info[1].As<Napi::Number>().Int32Value(),
    "", 0,
    info[2].As<Napi::Function>());
}

static Napi::Value StopCapture(const Napi::CallbackInfo& info) { return StopAudio(info); }

static Napi::Value StartPlayback(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto noop = Napi::Function::New(env, [](const Napi::CallbackInfo& cbInfo) { return cbInfo.Env().Undefined(); });
  return startAudioImpl(env,
    "", 0,
    info[0].As<Napi::String>(),
    info[1].As<Napi::Number>().Int32Value(),
    noop);
}

static Napi::Value StopPlayback(const Napi::CallbackInfo& info) { return StopAudio(info); }

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("listDevices",               Napi::Function::New(env, ListDevices));
  exports.Set("startAudio",                Napi::Function::New(env, StartAudio));
  exports.Set("stopAudio",                 Napi::Function::New(env, StopAudio));
  exports.Set("startCapture",              Napi::Function::New(env, StartCapture));
  exports.Set("stopCapture",               Napi::Function::New(env, StopCapture));
  exports.Set("startPlayback",             Napi::Function::New(env, StartPlayback));
  exports.Set("stopPlayback",              Napi::Function::New(env, StopPlayback));
  exports.Set("pushPlaybackSamples",       Napi::Function::New(env, PushPlaybackSamples));
  exports.Set("clearPlaybackChannel",      Napi::Function::New(env, ClearPlaybackChannel));
  exports.Set("playTestTone",              Napi::Function::New(env, PlayTestTone));
  exports.Set("setDefaultOutputDevice",    Napi::Function::New(env, SetDefaultOutputDevice));
  exports.Set("getDefaultOutputDeviceUID", Napi::Function::New(env, GetDefaultOutputDeviceUID));
  return exports;
}
NODE_API_MODULE(coreaudio, Init)
