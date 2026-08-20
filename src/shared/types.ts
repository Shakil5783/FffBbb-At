export type EmulatorState = 'missing-sdk' | 'needs-setup' | 'stopped' | 'booting' | 'running' | 'error'

export type GpuMode = 'auto' | 'host' | 'swiftshader_indirect'
export type PerformancePreset = 'eco' | 'balanced' | 'turbo' | 'custom'

export interface ToolAvailability {
  adb: boolean
  emulator: boolean
  sdkManager: boolean
  avdManager: boolean
}

export interface DeviceDetails {
  serial: string | null
  androidVersion: string | null
  apiLevel: string | null
  resolution: string | null
  model: string | null
  booted: boolean
}

export interface EmulatorSnapshot {
  platform: NodeJS.Platform | 'browser'
  state: EmulatorState
  sdkPath: string | null
  tools: ToolAvailability
  avds: string[]
  selectedAvd: string
  device: DeviceDetails
  error: string | null
  updatedAt: string
}

export interface Preferences {
  sdkPath: string | null
  selectedAvd: string
  memoryMb: number
  cpuCores: number
  gpuMode: GpuMode
  performancePreset: PerformancePreset
  coldBoot: boolean
  muted: boolean
  closeToTray: boolean
}

export interface InstalledApp {
  packageName: string
  label: string
  kind: 'user' | 'system'
  accent: string
}

export interface ActivityLog {
  id: string
  timestamp: string
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
}

export interface SetupProgress {
  phase: 'idle' | 'java' | 'download' | 'packages' | 'licenses' | 'avd' | 'done' | 'error'
  message: string
  percent: number
}

export interface KeyBinding {
  id: string
  key: string
  label: string
  x: number
  y: number
}

export interface KeymapState {
  enabled: boolean
  bindings: KeyBinding[]
}

export interface OperationResult<T = undefined> {
  ok: boolean
  message: string
  data?: T
}

export interface DroidDeckApi {
  getSnapshot: () => Promise<EmulatorSnapshot>
  getPreferences: () => Promise<Preferences>
  savePreferences: (preferences: Preferences) => Promise<OperationResult<Preferences>>
  chooseSdk: () => Promise<OperationResult<string | null>>
  prepareAndroid: () => Promise<OperationResult>
  startEmulator: () => Promise<OperationResult>
  stopEmulator: () => Promise<OperationResult>
  restartEmulator: () => Promise<OperationResult>
  installApk: () => Promise<OperationResult<string>>
  takeScreenshot: () => Promise<OperationResult<string>>
  listApps: () => Promise<OperationResult<InstalledApp[]>>
  launchApp: (packageName: string) => Promise<OperationResult>
  getKeymap: () => Promise<KeymapState>
  saveKeymap: (keymap: KeymapState) => Promise<OperationResult<KeymapState>>
  revealSdk: () => Promise<OperationResult>
  openExternal: (url: string) => Promise<void>
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  onSnapshot: (callback: (snapshot: EmulatorSnapshot) => void) => () => void
  onLog: (callback: (log: ActivityLog) => void) => () => void
  onSetupProgress: (callback: (progress: SetupProgress) => void) => () => void
}

declare global {
  interface Window {
    droiddeck?: DroidDeckApi
  }
}
