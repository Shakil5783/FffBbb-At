import { EventEmitter } from 'node:events'
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type {
  ActivityLog,
  EmulatorSnapshot,
  InstalledApp,
  OperationResult,
  Preferences,
  SetupProgress,
  ToolAvailability
} from '../shared/types'

const DEFAULT_AVD = 'DroidDeck_Android_11'
const EMPTY_TOOLS: ToolAvailability = {
  adb: false,
  emulator: false,
  sdkManager: false,
  avdManager: false
}

const DEFAULT_PREFERENCES: Preferences = {
  sdkPath: null,
  selectedAvd: DEFAULT_AVD,
  memoryMb: 4096,
  cpuCores: 4,
  gpuMode: 'auto',
  performancePreset: 'balanced',
  coldBoot: false,
  muted: false,
  closeToTray: false
}

type ToolPaths = {
  adb: string | null
  emulator: string | null
  sdkManager: string | null
  avdManager: string | null
}

function executable(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name
}

function batch(name: string): string {
  return process.platform === 'win32' ? `${name}.bat` : name
}

function cleanLine(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim()
}

function packageLabel(packageName: string): string {
  const finalPart = packageName.split('.').at(-1) || packageName
  return finalPart
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function parseAdbDevices(output: string): string[] {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2 && parts[1] === 'device')
    .map((parts) => parts[0])
}

export function parsePackages(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^package:/, ''))
    .filter(Boolean)
}

export class AndroidService extends EventEmitter {
  private readonly preferencesFile: string
  private readonly setupScript: string
  private preferences: Preferences
  private snapshot: EmulatorSnapshot
  private launchStartedAt: number | null = null
  private logs: ActivityLog[] = []
  private refreshPromise: Promise<EmulatorSnapshot> | null = null

  constructor(userDataPath: string, setupScript: string) {
    super()
    this.preferencesFile = join(userDataPath, 'preferences.json')
    this.setupScript = setupScript
    this.preferences = this.loadPreferences()
    this.snapshot = {
      platform: process.platform,
      state: 'missing-sdk',
      sdkPath: null,
      tools: { ...EMPTY_TOOLS },
      avds: [],
      selectedAvd: this.preferences.selectedAvd,
      device: {
        serial: null,
        androidVersion: null,
        apiLevel: null,
        resolution: null,
        model: null,
        booted: false
      },
      error: null,
      updatedAt: new Date().toISOString()
    }
  }

  getPreferences(): Preferences {
    return { ...this.preferences }
  }

  getLogs(): ActivityLog[] {
    return [...this.logs]
  }

  savePreferences(next: Preferences): OperationResult<Preferences> {
    const safe: Preferences = {
      sdkPath: next.sdkPath?.trim() || null,
      selectedAvd: next.selectedAvd?.trim() || DEFAULT_AVD,
      memoryMb: Math.min(16384, Math.max(1536, Math.round(next.memoryMb))),
      cpuCores: Math.min(16, Math.max(1, Math.round(next.cpuCores))),
      gpuMode: ['auto', 'host', 'swiftshader_indirect'].includes(next.gpuMode) ? next.gpuMode : 'auto',
      performancePreset: ['eco', 'balanced', 'turbo', 'custom'].includes(next.performancePreset)
        ? next.performancePreset
        : 'balanced',
      coldBoot: Boolean(next.coldBoot),
      muted: Boolean(next.muted),
      closeToTray: Boolean(next.closeToTray)
    }

    this.preferences = safe
    this.persistPreferences()
    this.log('success', 'Settings saved')
    void this.refresh()
    return { ok: true, message: 'Settings saved', data: { ...safe } }
  }

  setSdkPath(sdkPath: string): OperationResult<string> {
    this.preferences.sdkPath = sdkPath
    this.persistPreferences()
    this.log('success', `Android SDK folder linked: ${sdkPath}`)
    void this.refresh()
    return { ok: true, message: 'Android SDK folder linked', data: sdkPath }
  }

  async refresh(): Promise<EmulatorSnapshot> {
    if (this.refreshPromise) return this.refreshPromise

    this.refreshPromise = this.doRefresh().finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  private async doRefresh(): Promise<EmulatorSnapshot> {
    const sdkPath = this.detectSdkPath()
    const tools = sdkPath ? this.findTools(sdkPath) : { ...EMPTY_TOOLS }
    const paths = sdkPath ? this.getToolPaths(sdkPath) : null
    let avds: string[] = []
    let serial: string | null = null
    let error: string | null = null

    if (paths?.emulator) {
      try {
        avds = (await this.runText(paths.emulator, ['-list-avds']))
          .split(/\r?\n/)
          .map(cleanLine)
          .filter(Boolean)
      } catch (cause) {
        error = this.errorMessage(cause)
      }
    }

    if (paths?.adb) {
      try {
        const devices = parseAdbDevices(await this.runText(paths.adb, ['devices']))
          .filter((device) => device.startsWith('emulator-'))
        for (const device of devices) {
          try {
            const avdName = (await this.runText(paths.adb, ['-s', device, 'emu', 'avd', 'name']))
              .split(/\r?\n/)
              .map(cleanLine)
              .find((line) => line && line !== 'OK')
            if (avdName === this.preferences.selectedAvd) {
              serial = device
              break
            }
          } catch {
            // Ignore unrelated or not-yet-responsive emulator instances.
          }
        }
      } catch (cause) {
        error = error || this.errorMessage(cause)
      }
    }

    let androidVersion: string | null = null
    let apiLevel: string | null = null
    let resolution: string | null = null
    let model: string | null = null
    let booted = false

    if (paths?.adb && serial) {
      const property = async (name: string): Promise<string | null> => {
        try {
          return cleanLine(await this.runText(paths.adb!, ['-s', serial!, 'shell', 'getprop', name])) || null
        } catch {
          return null
        }
      }
      ;[androidVersion, apiLevel, model] = await Promise.all([
        property('ro.build.version.release'),
        property('ro.build.version.sdk'),
        property('ro.product.model')
      ])
      const bootComplete = await property('sys.boot_completed')
      booted = bootComplete === '1'
      try {
        resolution = cleanLine(await this.runText(paths.adb, ['-s', serial, 'shell', 'wm', 'size']))
          .replace(/^Physical size:\s*/i, '') || null
      } catch {
        resolution = null
      }
    }

    const hasSelectedAvd = avds.includes(this.preferences.selectedAvd)
    let state: EmulatorSnapshot['state']
    if (!sdkPath || !tools.adb || !tools.emulator) state = 'missing-sdk'
    else if (!hasSelectedAvd) state = 'needs-setup'
    else if (serial && booted) state = 'running'
    else if (serial || (this.launchStartedAt && Date.now() - this.launchStartedAt < 180_000)) state = 'booting'
    else if (error) state = 'error'
    else state = 'stopped'

    if (state === 'running' || state === 'stopped') this.launchStartedAt = null

    this.snapshot = {
      platform: process.platform,
      state,
      sdkPath,
      tools,
      avds,
      selectedAvd: this.preferences.selectedAvd,
      device: { serial, androidVersion, apiLevel, resolution, model, booted },
      error,
      updatedAt: new Date().toISOString()
    }
    this.emit('snapshot', this.snapshot)
    return this.snapshot
  }

  async prepareAndroid(): Promise<OperationResult> {
    if (process.platform !== 'win32') {
      return { ok: false, message: 'Automatic Android setup is available on Windows 10/11 only.' }
    }
    if (!existsSync(this.setupScript)) {
      return { ok: false, message: `Setup helper was not found at ${this.setupScript}` }
    }

    const sdkPath = this.preferences.sdkPath || this.defaultManagedSdkPath()
    mkdirSync(sdkPath, { recursive: true })
    this.emitProgress('java', 'Checking Java 17…', 5)
    this.log('info', 'Android 11 setup started')

    return new Promise((resolve) => {
      const child = spawn(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          this.setupScript,
          '-SdkRoot',
          sdkPath,
          '-AvdName',
          this.preferences.selectedAvd
        ],
        { windowsHide: true }
      )

      let stderr = ''
      const consume = (chunk: Buffer, isError = false): void => {
        const text = chunk.toString('utf8')
        if (isError) stderr += text
        for (const rawLine of text.split(/\r?\n/)) {
          const line = cleanLine(rawLine)
          if (!line) continue
          const setupMatch = line.match(/^DD:([^:]+):(.*)$/)
          if (setupMatch) {
            const phase = setupMatch[1] as SetupProgress['phase']
            this.emitProgress(phase, setupMatch[2].trim(), this.phasePercent(phase))
          } else {
            this.log(isError ? 'warning' : 'info', line)
          }
        }
      }

      child.stdout.on('data', (chunk: Buffer) => consume(chunk))
      child.stderr.on('data', (chunk: Buffer) => consume(chunk, true))
      child.on('error', (error) => {
        const message = `Could not start setup: ${error.message}`
        this.emitProgress('error', message, 0)
        this.log('error', message)
        resolve({ ok: false, message })
      })
      child.on('close', async (code) => {
        if (code === 0) {
          this.preferences.sdkPath = sdkPath
          this.persistPreferences()
          this.emitProgress('done', 'Android 11 is ready', 100)
          this.log('success', 'Android 11 virtual device is ready')
          await this.refresh()
          resolve({ ok: true, message: 'Android 11 setup completed' })
        } else {
          const finalError = cleanLine(stderr).split(/\r?\n/).at(-1)
          const message = finalError || `Setup exited with code ${code ?? 'unknown'}`
          this.emitProgress('error', message, 0)
          this.log('error', message)
          resolve({ ok: false, message })
        }
      })
    })
  }

  async start(): Promise<OperationResult> {
    const current = await this.refresh()
    if (current.state === 'running' || current.state === 'booting') {
      return { ok: true, message: current.state === 'running' ? 'Emulator is already running' : 'Emulator is starting' }
    }
    if (!current.sdkPath) return { ok: false, message: 'Set up or link an Android SDK first' }
    const emulator = this.getToolPaths(current.sdkPath).emulator
    if (!emulator) return { ok: false, message: 'Android Emulator tool is missing' }
    if (!current.avds.includes(this.preferences.selectedAvd)) {
      return { ok: false, message: 'Create the Android 11 device first' }
    }

    const args = [
      `@${this.preferences.selectedAvd}`,
      '-memory',
      String(this.preferences.memoryMb),
      '-cores',
      String(this.preferences.cpuCores),
      '-gpu',
      this.preferences.gpuMode
    ]
    if (this.preferences.coldBoot) args.push('-no-snapshot-load')
    if (this.preferences.muted) args.push('-no-audio')

    try {
      const child = spawn(emulator, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      })
      child.unref()
      this.launchStartedAt = Date.now()
      this.log('success', `Launching ${this.preferences.selectedAvd}`)
      void this.refresh()
      return { ok: true, message: 'Android 11 is starting' }
    } catch (cause) {
      const message = this.errorMessage(cause)
      this.log('error', message)
      return { ok: false, message }
    }
  }

  async stop(): Promise<OperationResult> {
    const current = await this.refresh()
    if (!current.sdkPath || !current.device.serial) {
      return { ok: true, message: 'Emulator is already stopped' }
    }
    const adb = this.getToolPaths(current.sdkPath).adb
    if (!adb) return { ok: false, message: 'ADB tool is missing' }
    try {
      await this.runText(adb, ['-s', current.device.serial, 'emu', 'kill'])
      this.launchStartedAt = null
      this.log('info', 'Emulator stopped safely')
      setTimeout(() => void this.refresh(), 1_000)
      return { ok: true, message: 'Emulator stopped' }
    } catch (cause) {
      const message = this.errorMessage(cause)
      this.log('error', message)
      return { ok: false, message }
    }
  }

  async restart(): Promise<OperationResult> {
    const stopped = await this.stop()
    if (!stopped.ok) return stopped
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    return this.start()
  }

  async installApk(apkPath: string): Promise<OperationResult<string>> {
    const current = await this.refresh()
    if (!current.sdkPath || !current.device.serial || current.state !== 'running') {
      return { ok: false, message: 'Start Android 11 before installing an APK' }
    }
    const adb = this.getToolPaths(current.sdkPath).adb
    if (!adb) return { ok: false, message: 'ADB tool is missing' }
    try {
      this.log('info', `Installing ${apkPath.split(/[\\/]/).at(-1) || 'APK'}…`)
      const output = await this.runText(adb, ['-s', current.device.serial, 'install', '-r', apkPath], 300_000)
      if (!/success/i.test(output)) throw new Error(cleanLine(output) || 'APK installation failed')
      this.log('success', 'APK installed successfully')
      return { ok: true, message: 'APK installed successfully', data: apkPath }
    } catch (cause) {
      const message = this.errorMessage(cause)
      this.log('error', message)
      return { ok: false, message }
    }
  }

  async takeScreenshot(savePath: string): Promise<OperationResult<string>> {
    const current = await this.refresh()
    if (!current.sdkPath || !current.device.serial) {
      return { ok: false, message: 'Start Android 11 before taking a screenshot' }
    }
    const adb = this.getToolPaths(current.sdkPath).adb
    if (!adb) return { ok: false, message: 'ADB tool is missing' }

    return new Promise((resolve) => {
      execFile(
        adb,
        ['-s', current.device.serial!, 'exec-out', 'screencap', '-p'],
        { encoding: 'buffer', maxBuffer: 30 * 1024 * 1024, windowsHide: true },
        (error, stdout) => {
          if (error) {
            const message = error.message
            this.log('error', message)
            resolve({ ok: false, message })
            return
          }
          try {
            mkdirSync(dirname(savePath), { recursive: true })
            writeFileSync(savePath, stdout)
            this.log('success', `Screenshot saved to ${savePath}`)
            resolve({ ok: true, message: 'Screenshot saved', data: savePath })
          } catch (cause) {
            const message = this.errorMessage(cause)
            this.log('error', message)
            resolve({ ok: false, message })
          }
        }
      )
    })
  }

  async listApps(): Promise<OperationResult<InstalledApp[]>> {
    const current = await this.refresh()
    if (!current.sdkPath || !current.device.serial || current.state !== 'running') {
      return { ok: false, message: 'Start Android 11 to view installed apps', data: [] }
    }
    const adb = this.getToolPaths(current.sdkPath).adb
    if (!adb) return { ok: false, message: 'ADB tool is missing', data: [] }
    try {
      const packages = parsePackages(
        await this.runText(adb, ['-s', current.device.serial, 'shell', 'pm', 'list', 'packages', '-3'])
      )
      const accents = ['violet', 'cyan', 'amber', 'pink', 'green']
      const apps = packages.map((packageName, index): InstalledApp => ({
        packageName,
        label: packageLabel(packageName),
        kind: 'user',
        accent: accents[index % accents.length]
      }))
      return { ok: true, message: `${apps.length} user apps found`, data: apps }
    } catch (cause) {
      return { ok: false, message: this.errorMessage(cause), data: [] }
    }
  }

  async launchApp(packageName: string): Promise<OperationResult> {
    if (!/^[a-zA-Z0-9._]+$/.test(packageName)) return { ok: false, message: 'Invalid Android package name' }
    const current = await this.refresh()
    if (!current.sdkPath || !current.device.serial || current.state !== 'running') {
      return { ok: false, message: 'Start Android 11 before opening an app' }
    }
    const adb = this.getToolPaths(current.sdkPath).adb
    if (!adb) return { ok: false, message: 'ADB tool is missing' }
    try {
      await this.runText(adb, [
        '-s',
        current.device.serial,
        'shell',
        'monkey',
        '-p',
        packageName,
        '-c',
        'android.intent.category.LAUNCHER',
        '1'
      ])
      this.log('success', `Opened ${packageName}`)
      return { ok: true, message: 'App opened in Android 11' }
    } catch (cause) {
      const message = this.errorMessage(cause)
      this.log('error', message)
      return { ok: false, message }
    }
  }

  sendTap(x: number, y: number): void {
    const current = this.snapshot
    if (!current.sdkPath || !current.device.serial || current.state !== 'running') return
    const adb = this.getToolPaths(current.sdkPath).adb
    if (!adb) return
    void this.runText(adb, [
      '-s',
      current.device.serial,
      'shell',
      'input',
      'tap',
      String(Math.round(x)),
      String(Math.round(y))
    ]).catch((cause) => this.log('warning', `Key tap failed: ${this.errorMessage(cause)}`))
  }

  private detectSdkPath(): string | null {
    const candidates = [
      this.preferences.sdkPath,
      process.env.ANDROID_SDK_ROOT,
      process.env.ANDROID_HOME,
      process.platform === 'win32' && process.env.LOCALAPPDATA
        ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk')
        : null,
      process.platform === 'darwin' ? join(homedir(), 'Library', 'Android', 'sdk') : null,
      process.platform === 'linux' ? join(homedir(), 'Android', 'Sdk') : null,
      this.defaultManagedSdkPath()
    ]
    return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate))) || null
  }

  private defaultManagedSdkPath(): string {
    if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
      return join(process.env.LOCALAPPDATA, 'DroidDeck', 'Android', 'Sdk')
    }
    return join(dirname(this.preferencesFile), 'Android', 'Sdk')
  }

  private findTools(sdkPath: string): ToolAvailability {
    const paths = this.getToolPaths(sdkPath)
    return {
      adb: Boolean(paths.adb),
      emulator: Boolean(paths.emulator),
      sdkManager: Boolean(paths.sdkManager),
      avdManager: Boolean(paths.avdManager)
    }
  }

  private getToolPaths(sdkPath: string): ToolPaths {
    const locate = (candidates: string[]): string | null => candidates.find(existsSync) || null
    const commandLineRoots = [
      join(sdkPath, 'cmdline-tools', 'latest', 'bin'),
      join(sdkPath, 'cmdline-tools', 'bin'),
      join(sdkPath, 'tools', 'bin')
    ]
    return {
      adb: locate([join(sdkPath, 'platform-tools', executable('adb'))]),
      emulator: locate([join(sdkPath, 'emulator', executable('emulator'))]),
      sdkManager: locate(commandLineRoots.map((root) => join(root, batch('sdkmanager')))),
      avdManager: locate(commandLineRoots.map((root) => join(root, batch('avdmanager'))))
    }
  }

  private runText(file: string, args: string[], timeout = 30_000): Promise<string> {
    let command = file
    let commandArgs = args
    if (process.platform === 'win32' && /\.(bat|cmd)$/i.test(file)) {
      const safe = (value: string): string => `'${value.replace(/'/g, "''")}'`
      const expression = `& ${safe(file)} ${args.map(safe).join(' ')}`
      command = 'powershell.exe'
      commandArgs = ['-NoProfile', '-NonInteractive', '-Command', expression]
    }
    return new Promise((resolve, reject) => {
      execFile(
        command,
        commandArgs,
        { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout, windowsHide: true },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(cleanLine(stderr || stdout) || error.message))
            return
          }
          resolve(stdout)
        }
      )
    })
  }

  private loadPreferences(): Preferences {
    try {
      const saved = JSON.parse(readFileSync(this.preferencesFile, 'utf8')) as Partial<Preferences>
      return { ...DEFAULT_PREFERENCES, ...saved }
    } catch {
      return { ...DEFAULT_PREFERENCES }
    }
  }

  private persistPreferences(): void {
    mkdirSync(dirname(this.preferencesFile), { recursive: true })
    writeFileSync(this.preferencesFile, JSON.stringify(this.preferences, null, 2), 'utf8')
  }

  private phasePercent(phase: SetupProgress['phase']): number {
    return { idle: 0, java: 8, download: 22, licenses: 45, packages: 62, avd: 88, done: 100, error: 0 }[phase]
  }

  private emitProgress(phase: SetupProgress['phase'], message: string, percent: number): void {
    this.emit('progress', { phase, message, percent } satisfies SetupProgress)
    if (phase !== 'error') this.log('info', message)
  }

  private log(level: ActivityLog['level'], message: string): void {
    const entry: ActivityLog = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: new Date().toISOString(),
      level,
      message
    }
    this.logs = [entry, ...this.logs].slice(0, 250)
    this.emit('log', entry)
  }

  private errorMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
  }
}
