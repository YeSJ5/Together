# TOGETHER iOS Scaffold

This folder is a scaffold for the native iOS client path that TOGETHER needs for reliable background playback.

## Why this exists

The web/PWA experience is useful, but iPhone background audio reliability requires a native app configuration using:

- `AVAudioSession` with the `playback` category
- `UIBackgroundModes` including `audio`
- iOS media controls / now playing integration

## Intended next steps

1. Run `npm run ios:add` from `frontend/` on a macOS machine with Xcode.
2. Copy `App/App/TogetherAudioPlugin.swift` into the generated Capacitor iOS app target.
3. Enable Background Modes in Xcode:
   - Audio, AirPlay, and Picture in Picture
4. Add `UIBackgroundModes` = `audio` in the app target's `Info.plist`.
5. Connect the native playback path to the LiveKit-backed mobile listener flow.

## Product reality

- Reliable background listening on iPhone: supported through the native app path.
- Microphone host mode on iPhone: supported through the native app path.
- Audio file host mode on iPhone: supported through the native app path.
- Capturing audio output from arbitrary other apps on iPhone: not generally supported in the same way as Android.
