import type {
  ActivityLog,
  DroidDeckApi,
  EmulatorSnapshot,
  InstalledApp,
  Preferences,
  SetupProgress,
  KeymapState
} from '../../../shared/types'

export const desktopMode = Boolean(window.droiddeck)

const snapshotListeners = new Set<(snapshot: EmulatorSnapshot) => void>()
const logListeners = new Set<(log: ActivityLog) => void>()
const progressListeners = new Set<(progress: SetupProgress) => void>()

let mockPreferences: Preferences = {
  sdkPath: 'C:\\Users\\Demo\\AppData\\Local\\Android\\Sdk',
  selectedAvd: 'DroidDeck_Android_11',
  memoryMb: 4096,
  cpuCores: 4,
  gpuMode: 'auto',
  performancePreset: 'balanced',
  coldBoot: false,
  muted: false,
  closeToTray: false
}

let mockSnapshot: EmulatorSnapshot = {
  platform: 'browser',
  state: 'running',
  sdkPath: mockPreferences.sdkPath,
  tools: { adb: true, emulator: true, sdkManager: true, avdManager: true },
  avds: ['DroidDeck_Android_11'],
  selectedAvd: 'DroidDeck_Android_11',
  device: {
    serial: 'emulator-5554',
    androidVersion: '11',
    apiLevel: '30',
    resolution: '1080x2400',
    model: 'Pixel 5',
    booted: true
  },
  error: null,
  updatedAt: new Date().toISOString()
}

let mockKeymap: KeymapState = {
  enabled: false,
  bindings: [
    { id: 'skill-1', key: 'Q', label: 'Skill 1', x: 860, y: 2050 },
    { id: 'skill-2', key: 'E', label: 'Skill 2', x: 980, y: 1910 },
    { id: 'action', key: 'Space', label: 'Primary action', x: 890, y: 2200 }
  ]
}

const mockApps: InstalledApp[] = [
  { packageName: 'com.supercell.clashofclans', label: 'Clash of Clans', kind: 'user', accent: 'amber' },
  { packageName: 'com.discord', label: 'Discord', kind: 'user', accent: 'violet' },
  { packageName: 'com.spotify.music', label: 'Spotify', kind: 'user', accent: 'green' },
  { packageName: 'com.google.android.youtube', label: 'YouTube', kind: 'user', accent: 'pink' }
]

function emitSnapshot(): void {
  mockSnapshot = { ...mockSnapshot, updatedAt: new Date().toISOString() }
  snapshotListeners.forEach((listener) => listener(mockSnapshot))
}

function emitLog(message: string, level: ActivityLog['level'] = 'info'): void {
  const log: ActivityLog = {
    id: `${Date.now()}`,
    timestamp: new Date().toISOString(),
    level,
    message
  }
  logListeners.forEach((listener) => listener(log))
}

const mockApi: DroidDeckApi = {
  getSnapshot: async () => mockSnapshot,
  getPreferences: async () => mockPreferences,
  savePreferences: async (preferences) => {
    mockPreferences = { ...preferences }
    emitLog('Settings saved', 'success')
    return { ok: true, message: 'Settings saved', data: mockPreferences }
  },
  chooseSdk: async () => ({ ok: true, message: 'SDK folder linked', data: mockPreferences.sdkPath }),
  prepareAndroid: async () => {
    const phases: SetupProgress[] = [
      { phase: 'java', message: 'Checking Java 17…', percent: 8 },
      { phase: 'download', message: 'Downloading command-line tools…', percent: 22 },
      { phase: 'packages', message: 'Installing Android 11 image…', percent: 62 },
      { phase: 'avd', message: 'Creating virtual device…', percent: 88 },
      { phase: 'done', message: 'Android 11 is ready', percent: 100 }
    ]
    for (const progress of phases) {
      progressListeners.forEach((listener) => listener(progress))
      await new Promise((resolve) => setTimeout(resolve, 350))
    }
    return { ok: true, message: 'Android 11 setup completed' }
  },
  startEmulator: async () => {
    mockSnapshot = { ...mockSnapshot, state: 'booting', device: { ...mockSnapshot.device, booted: false } }
    emitSnapshot()
    emitLog('Launching Android 11', 'info')
    setTimeout(() => {
      mockSnapshot = { ...mockSnapshot, state: 'running', device: { ...mockSnapshot.device, booted: true } }
      emitSnapshot()
      emitLog('Android 11 is ready', 'success')
    }, 1_200)
    return { ok: true, message: 'Android 11 is starting' }
  },
  stopEmulator: async () => {
    mockSnapshot = {
      ...mockSnapshot,
      state: 'stopped',
      device: { ...mockSnapshot.device, serial: null, booted: false }
    }
    emitSnapshot()
    emitLog('Emulator stopped safely')
    return { ok: true, message: 'Emulator stopped' }
  },
  restartEmulator: async () => {
    mockSnapshot = { ...mockSnapshot, state: 'booting', device: { ...mockSnapshot.device, booted: false } }
    emitSnapshot()
    emitLog('Restarting Android 11')
    setTimeout(() => {
      mockSnapshot = { ...mockSnapshot, state: 'running', device: { ...mockSnapshot.device, booted: true } }
      emitSnapshot()
    }, 1_200)
    return { ok: true, message: 'Android 11 is restarting' }
  },
  installApk: async () => {
    emitLog('Demo APK installed', 'success')
    return { ok: true, message: 'APK installed successfully', data: 'demo.apk' }
  },
  takeScreenshot: async () => {
    emitLog('Screenshot saved', 'success')
    return { ok: true, message: 'Screenshot saved', data: 'Pictures/DroidDeck-demo.png' }
  },
  listApps: async () => ({ ok: true, message: `${mockApps.length} apps found`, data: mockApps }),
  launchApp: async (packageName) => {
    emitLog(`Opened ${packageName}`, 'success')
    return { ok: true, message: 'App opened in Android 11' }
  },
  getKeymap: async () => mockKeymap,
  saveKeymap: async (next) => {
    mockKeymap = next
    emitLog(next.enabled ? 'Global key mapping enabled' : 'Key mapping disabled', 'success')
    return { ok: true, message: 'Key map saved', data: mockKeymap }
  },
  revealSdk: async () => ({ ok: true, message: 'SDK folder opened' }),
  openExternal: async () => undefined,
  minimizeWindow: () => undefined,
  maximizeWindow: () => undefined,
  closeWindow: () => undefined,
  onSnapshot: (callback) => {
    snapshotListeners.add(callback)
    return () => snapshotListeners.delete(callback)
  },
  onLog: (callback) => {
    logListeners.add(callback)
    return () => logListeners.delete(callback)
  },
  onSetupProgress: (callback) => {
    progressListeners.add(callback)
    return () => progressListeners.delete(callback)
  }
}

export const api: DroidDeckApi = window.droiddeck || mockApi
