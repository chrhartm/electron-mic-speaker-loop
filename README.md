# 10s Mic Speaker Looper

Minimal Electron app that records a 10-second clip and loops playback.

## What It Captures

- Microphone audio
- System audio (when available)

## Requirements

- Node.js 16+
- Electron 39+ (project currently uses Electron 40)
- macOS permissions: Microphone, Screen Recording, and system audio sharing in capture prompt

## Commands

```bash
npm install
npm start
npm run build
```

## Important (macOS loopback)

For reliable system-audio loopback testing on macOS, run the built `.app` from `dist/`.
Use `npm start` for general development and UI checks.

## Usage

1. Open the app.
2. Click `Record 10s + Loop Playback`.
3. Select a screen/window and enable audio sharing.
4. Wait 10 seconds.
5. The clip plays in a loop.
6. Click `Stop Loop` to stop.
