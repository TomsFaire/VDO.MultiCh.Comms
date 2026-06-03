#include <napi.h>
#include <CoreAudio/CoreAudio.h>
#include <vector>
#include <string>
#include <atomic>

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
  AudioObjectGetPropertyData(id, &addr, 0, nullptr, &size, list);
  int total = 0;
  for (UInt32 i = 0; i < list->mNumberBuffers; i++)
    total += list->mBuffers[i].mNumberChannels;
  return total;
}

static AudioDeviceID findDeviceByUID(const std::string& uid) {
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

// ── capture state ─────────────────────────────────────────────────────────────

struct CaptureState {
  AudioDeviceID            deviceId  = kAudioDeviceUnknown;
  AudioDeviceIOProcID      procId    = nullptr;
  int                      nChannels = 0;
  Napi::ThreadSafeFunction tsfn;
  std::atomic<bool>        running{false};
};

static CaptureState g_cap;

// CoreAudio delivers non-interleaved Float32 on macOS (one buffer per channel).
// NonBlockingCall schedules the JS callback on the Node.js thread via the TSFN's
// internal libuv async handle — no separate uv_async_t needed.
static OSStatus HalCallback(AudioDeviceID,
                             const AudioTimeStamp*,
                             const AudioBufferList* inData,
                             const AudioTimeStamp*,
                             AudioBufferList*,
                             const AudioTimeStamp*,
                             void*) {
  if (!g_cap.running) return noErr;

  int nBufs = (int)inData->mNumberBuffers;
  for (int ch = 0; ch < g_cap.nChannels && ch < nBufs; ch++) {
    const auto& buf = inData->mBuffers[ch];
    int n = (int)(buf.mDataByteSize / sizeof(float));
    std::vector<float> samples(static_cast<const float*>(buf.mData),
                               static_cast<const float*>(buf.mData) + n);
    g_cap.tsfn.NonBlockingCall(
      [ch, s = std::move(samples)](Napi::Env env, Napi::Function cb) {
        auto arr = Napi::Float32Array::New(env, s.size());
        std::copy(s.begin(), s.end(), arr.Data());
        cb.Call({ Napi::Number::New(env, ch), arr });
      }
    );
  }
  return noErr;
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

// startCapture(uid: string, nChannels: number, callback: (ch: number, samples: Float32Array) => void)
static Napi::Value StartCapture(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (g_cap.running) {
    Napi::Error::New(env, "capture already running").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::string uid   = info[0].As<Napi::String>();
  int nChannels     = info[1].As<Napi::Number>().Int32Value();
  Napi::Function cb = info[2].As<Napi::Function>();

  AudioDeviceID devId = findDeviceByUID(uid);
  if (devId == kAudioDeviceUnknown) {
    Napi::Error::New(env, "device not found: " + uid).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  g_cap.deviceId  = devId;
  g_cap.nChannels = nChannels;
  g_cap.tsfn = Napi::ThreadSafeFunction::New(env, cb, "CoreAudioCapture", 0, 1);

  g_cap.running = true;
  AudioDeviceCreateIOProcID(devId, HalCallback, nullptr, &g_cap.procId);
  AudioDeviceStart(devId, g_cap.procId);

  return env.Undefined();
}

static Napi::Value StopCapture(const Napi::CallbackInfo& info) {
  if (!g_cap.running) return info.Env().Undefined();
  g_cap.running = false;
  AudioDeviceStop(g_cap.deviceId, g_cap.procId);
  AudioDeviceDestroyIOProcID(g_cap.deviceId, g_cap.procId);
  g_cap.procId = nullptr;
  g_cap.tsfn.Release();
  return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("listDevices",  Napi::Function::New(env, ListDevices));
  exports.Set("startCapture", Napi::Function::New(env, StartCapture));
  exports.Set("stopCapture",  Napi::Function::New(env, StopCapture));
  return exports;
}
NODE_API_MODULE(coreaudio, Init)
