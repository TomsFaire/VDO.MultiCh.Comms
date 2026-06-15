{
  "targets": [{
    "target_name": "coreaudio",
    "sources": ["coreaudio.mm"],
    "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
    "link_settings": {
      "libraries": ["-framework CoreAudio", "-framework Foundation"]
    },
    "xcode_settings": {
      "OTHER_CFLAGS": ["-ObjC++"],
      "MACOSX_DEPLOYMENT_TARGET": "12.0"
    }
  }]
}
