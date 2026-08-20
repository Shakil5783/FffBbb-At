# DroidDeck 11

A Windows desktop launcher and control center for an **Android 11 (API 30)** virtual device. DroidDeck uses Google's official Android SDK Emulator as its backend and adds a focused desktop dashboard for setup, launch control, APK installation, screenshots, app discovery, performance presets, logs, and ADB-powered tap mappings.

> DroidDeck is an independent project. It is not BlueStacks and is not affiliated with BlueStacks, Google, or Android Studio.

## Features

- Guided, idempotent Windows setup for Java 17, Android command-line tools, API 30, and a Pixel 5 AVD
- Start, stop, and restart the Android 11 virtual device
- Detect Android SDK installations from standard Windows paths or choose one manually
- Install local APK files through ADB
- Discover and launch user-installed Android apps
- Save full-resolution PNG screenshots
- Eco, Balanced, Turbo, and custom CPU/RAM profiles
- Host, automatic, or software GPU rendering
- Optional cold boot and muted launch modes
- Global keyboard-to-touch mappings backed by `adb shell input tap`
- Local activity and diagnostic timeline
- Secure Electron bridge with context isolation and a whitelisted IPC surface

## Requirements

- Windows 10 or Windows 11, 64-bit
- CPU virtualization enabled in UEFI/BIOS (Intel VT-x or AMD-V)
- Windows Hypervisor Platform enabled for hardware acceleration
- About 12 GB free disk space for the SDK, emulator, and Android 11 image
- Internet access during first-time setup

The setup helper uses Android Studio's bundled Java runtime when available. Otherwise it can install Microsoft OpenJDK 17 through `winget`.

## Development

```bash
npm install
npm run dev
```

To run only the renderer in a browser with interactive demo data:

```bash
npm run dev:web
```

Quality checks:

```bash
npm run typecheck
npm test
npm run build
```

## Build the Windows installer

Run this on a Windows x64 machine:

```powershell
npm install
npm run dist:win
```

The NSIS installer is written to `release/DroidDeck-11-Setup-<version>.exe`.

Android SDK binaries and system images are intentionally **not checked into this repository or bundled into the EXE**. On first setup, `scripts/setup-android.ps1` downloads official components from `dl.google.com`, accepts the Android SDK licenses, and creates `DroidDeck_Android_11`.

## Touch mapping

DroidDeck's key map captures configured keys globally while mapping is enabled. Each key sends a real tap to an `(x, y)` coordinate on the active emulator. Disable mapping before typing with those keys in another application.

The default 1080 × 2400 profile uses coordinates measured from the top-left corner:

- `x = 0`, `y = 0`: top-left
- `x = 1080`, `y = 2400`: bottom-right

## Project layout

```text
src/main/       Electron main process and Android/ADB service
src/preload/    Typed, context-isolated IPC bridge
src/renderer/   React dashboard
src/shared/     Shared API and data contracts
scripts/        Windows Android 11 setup helper
```

## License

MIT © 2026 Shakil5783
