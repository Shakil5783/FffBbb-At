import { useEffect, useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  AlertTriangle,
  AppWindow,
  Bot,
  Box,
  Camera,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cpu,
  Download,
  ExternalLink,
  FolderOpen,
  Gamepad2,
  Gauge,
  HardDrive,
  Home,
  Info,
  Keyboard,
  LayoutGrid,
  Maximize2,
  MemoryStick,
  Minimize2,
  Monitor,
  PackagePlus,
  Play,
  Plus,
  Power,
  RefreshCcw,
  RotateCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Square,
  SquareTerminal,
  Trash2,
  Wifi,
  X,
  Zap
} from 'lucide-react'
import { api, desktopMode } from './lib/bridge'
import type {
  ActivityLog,
  EmulatorSnapshot,
  InstalledApp,
  KeyBinding,
  KeymapState,
  OperationResult,
  Preferences,
  SetupProgress
} from '../../shared/types'

const emptySnapshot: EmulatorSnapshot = {
  platform: 'browser',
  state: 'missing-sdk',
  sdkPath: null,
  tools: { adb: false, emulator: false, sdkManager: false, avdManager: false },
  avds: [],
  selectedAvd: 'DroidDeck_Android_11',
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

const defaultPreferences: Preferences = {
  sdkPath: null,
  selectedAvd: 'DroidDeck_Android_11',
  memoryMb: 4096,
  cpuCores: 4,
  gpuMode: 'auto',
  performancePreset: 'balanced',
  coldBoot: false,
  muted: false,
  closeToTray: false
}

const initialLogs: ActivityLog[] = [
  {
    id: 'welcome',
    timestamp: new Date().toISOString(),
    level: 'info',
    message: 'DroidDeck control center initialized'
  }
]

type Page = 'home' | 'apps' | 'keymap' | 'activity' | 'settings'
type Toast = { message: string; kind: 'success' | 'error' | 'info' } | null

const stateCopy = {
  'missing-sdk': { label: 'Setup required', detail: 'Android SDK not linked', tone: 'warning' },
  'needs-setup': { label: 'Device required', detail: 'Create your Android 11 AVD', tone: 'warning' },
  stopped: { label: 'Ready to launch', detail: 'Android 11 • API 30', tone: 'ready' },
  booting: { label: 'Starting up', detail: 'Preparing your Android workspace', tone: 'active' },
  running: { label: 'Android is live', detail: 'Connected over ADB', tone: 'active' },
  error: { label: 'Needs attention', detail: 'Open activity for details', tone: 'danger' }
} as const

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp))
}

function AppLogo({ compact = false }: { compact?: boolean }): JSX.Element {
  return (
    <div className={`brand ${compact ? 'compact' : ''}`}>
      <div className="brand-mark" aria-hidden="true">
        <div className="brand-mark-inner"><Bot size={20} strokeWidth={2.2} /></div>
      </div>
      {!compact && (
        <div className="brand-copy">
          <strong>DroidDeck</strong>
          <span>ANDROID 11</span>
        </div>
      )}
    </div>
  )
}

function TitleBar(): JSX.Element {
  return (
    <header className="titlebar">
      <div className="titlebar-drag">
        <AppLogo />
        <div className="titlebar-center">
          <span className={`connection-dot ${desktopMode ? 'desktop' : ''}`} />
          {desktopMode ? 'Windows control center' : 'Interactive web preview'}
        </div>
      </div>
      <div className="window-controls">
        <button aria-label="Minimize" onClick={() => api.minimizeWindow()}><Minimize2 size={15} /></button>
        <button aria-label="Maximize" onClick={() => api.maximizeWindow()}><Square size={12} /></button>
        <button className="window-close" aria-label="Close" onClick={() => api.closeWindow()}><X size={16} /></button>
      </div>
    </header>
  )
}

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
  badge
}: {
  icon: LucideIcon
  label: string
  active: boolean
  onClick: () => void
  badge?: string
}): JSX.Element {
  return (
    <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>
      <Icon size={19} strokeWidth={active ? 2.3 : 1.8} />
      <span>{label}</span>
      {badge && <small>{badge}</small>}
    </button>
  )
}

function Sidebar({ page, setPage, state }: { page: Page; setPage: (page: Page) => void; state: EmulatorSnapshot['state'] }): JSX.Element {
  const nav: { page: Page; label: string; icon: LucideIcon; badge?: string }[] = [
    { page: 'home', label: 'Overview', icon: Home },
    { page: 'apps', label: 'App library', icon: LayoutGrid },
    { page: 'keymap', label: 'Key mapping', icon: Gamepad2 },
    { page: 'activity', label: 'Activity', icon: Activity },
    { page: 'settings', label: 'Settings', icon: Settings }
  ]
  return (
    <aside className="sidebar">
      <div className="nav-group">
        <span className="nav-label">WORKSPACE</span>
        {nav.map((item) => (
          <NavItem
            key={item.page}
            {...item}
            active={page === item.page}
            onClick={() => setPage(item.page)}
          />
        ))}
      </div>
      <div className="sidebar-spacer" />
      <div className="sidebar-device">
        <div className="device-mini-icon"><Smartphone size={18} /></div>
        <div>
          <strong>Android 11</strong>
          <span><i className={`mini-status ${state}`} />{stateCopy[state].label}</span>
        </div>
        <ChevronRight size={16} />
      </div>
      <button className="help-link" onClick={() => void api.openExternal('https://developer.android.com/studio/run/emulator')}>
        <CircleHelp size={17} /> Emulator guide <ExternalLink size={13} />
      </button>
      <div className="version">DROIDDECK 11 · v0.1.0</div>
    </aside>
  )
}

function SectionHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }): JSX.Element {
  return (
    <div className="section-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </div>
  )
}

function PhonePreview({ snapshot }: { snapshot: EmulatorSnapshot }): JSX.Element {
  const running = snapshot.state === 'running'
  const booting = snapshot.state === 'booting'
  return (
    <div className="device-stage" aria-label={`Android device is ${snapshot.state}`}>
      <div className="orbit orbit-one" />
      <div className="orbit orbit-two" />
      <div className={`phone ${running ? 'phone-running' : ''}`}>
        <div className="phone-speaker" />
        <div className="phone-screen">
          <div className="phone-statusbar">
            <span>11:08</span><span><Wifi size={9} /><span className="battery" /></span>
          </div>
          {running ? (
            <>
              <div className="phone-wallpaper">
                <div className="wallpaper-glow" />
                <span>Android 11</span>
                <strong>Ready to play.</strong>
              </div>
              <div className="phone-app-row">
                <i><Play size={12} fill="currentColor" /></i>
                <i><Gamepad2 size={13} /></i>
                <i><Settings size={12} /></i>
                <i><Box size={12} /></i>
              </div>
              <div className="phone-search"><Search size={9} /><span>Search apps</span></div>
            </>
          ) : booting ? (
            <div className="phone-loading"><div className="android-loader"><Bot size={25} /></div><strong>Starting Android</strong><span>Optimizing workspace…</span></div>
          ) : (
            <div className="phone-off"><Power size={25} /><strong>Device offline</strong><span>Launch when you're ready</span></div>
          )}
          <div className="phone-nav"><i /><i /><i /></div>
        </div>
      </div>
      <div className={`device-live-pill ${running ? 'on' : ''}`}><span />{running ? 'LIVE DEVICE' : booting ? 'BOOTING' : 'STANDBY'}</div>
    </div>
  )
}

function QuickAction({ icon: Icon, title, copy, onClick, disabled = false }: { icon: LucideIcon; title: string; copy: string; onClick: () => void; disabled?: boolean }): JSX.Element {
  return (
    <button className="quick-action" onClick={onClick} disabled={disabled}>
      <span className="quick-icon"><Icon size={19} /></span>
      <span><strong>{title}</strong><small>{copy}</small></span>
      <ChevronRight size={17} />
    </button>
  )
}

function HomePage({
  snapshot,
  preferences,
  busy,
  onPrimary,
  onRestart,
  onInstall,
  onScreenshot,
  onOpenSetup,
  setPage
}: {
  snapshot: EmulatorSnapshot
  preferences: Preferences
  busy: string | null
  onPrimary: () => void
  onRestart: () => void
  onInstall: () => void
  onScreenshot: () => void
  onOpenSetup: () => void
  setPage: (page: Page) => void
}): JSX.Element {
  const copy = stateCopy[snapshot.state]
  const needsSetup = snapshot.state === 'missing-sdk' || snapshot.state === 'needs-setup'
  const running = snapshot.state === 'running'
  return (
    <>
      <SectionHeader eyebrow="CONTROL CENTER" title="Good to see you." description="Your Android 11 workspace, tuned and ready from one place." actions={
        <div className={`status-chip ${copy.tone}`}><span />{copy.label}</div>
      } />

      {!desktopMode && (
        <div className="preview-banner"><Sparkles size={16} /><span>You’re viewing the interactive browser preview. Build the Windows EXE to connect real Android SDK tools.</span></div>
      )}

      {needsSetup && (
        <button className="setup-banner" onClick={onOpenSetup}>
          <span className="setup-banner-icon"><Download size={21} /></span>
          <span><strong>{snapshot.state === 'missing-sdk' ? 'Finish your one-time Android setup' : 'Create your Android 11 device'}</strong><small>Guided setup installs official Google SDK components and creates an API 30 AVD.</small></span>
          <span className="setup-banner-cta">Set up now <ChevronRight size={16} /></span>
        </button>
      )}

      <section className="hero-card">
        <div className="hero-glow" />
        <div className="hero-content">
          <div className="hero-kicker"><span className={`pulse-dot ${running ? 'on' : ''}`} /> {copy.detail}</div>
          <h2>{running ? 'Your Android world is live.' : needsSetup ? 'Android 11, without the clutter.' : 'Ready when you are.'}</h2>
          <p>{running ? 'Install apps, capture moments, and tune performance while your virtual device keeps running.' : 'A focused launcher powered by the official Android Emulator—safe, familiar, and yours to tune.'}</p>
          <div className="hero-actions">
            <button className={`primary-action ${running ? 'stop' : ''}`} onClick={onPrimary} disabled={Boolean(busy)}>
              {busy === 'primary' ? <span className="button-spinner" /> : running ? <Power size={18} /> : needsSetup ? <Download size={18} /> : <Play size={18} fill="currentColor" />}
              {running ? 'Stop Android' : needsSetup ? 'Set up Android 11' : snapshot.state === 'booting' ? 'Starting…' : 'Launch Android 11'}
            </button>
            {!needsSetup && <button className="ghost-action" onClick={() => setPage('settings')}><SlidersHorizontal size={17} /> Performance</button>}
          </div>
          <div className="hero-trust"><ShieldCheck size={15} /><span>Official Android SDK</span><i /><Cpu size={15} /><span>Hardware accelerated</span></div>
        </div>
        <PhonePreview snapshot={snapshot} />
      </section>

      <div className="stats-grid">
        <div className="stat-card"><span className="stat-icon violet"><Cpu size={18} /></span><div><small>PROCESSOR</small><strong>{preferences.cpuCores} cores</strong><span>{preferences.performancePreset} preset</span></div><Gauge size={17} className="stat-corner" /></div>
        <div className="stat-card"><span className="stat-icon cyan"><MemoryStick size={18} /></span><div><small>MEMORY</small><strong>{(preferences.memoryMb / 1024).toFixed(preferences.memoryMb % 1024 ? 1 : 0)} GB</strong><span>assigned to Android</span></div><span className="mini-meter"><i style={{ width: `${Math.min(100, preferences.memoryMb / 128)}%` }} /></span></div>
        <div className="stat-card"><span className="stat-icon green"><Monitor size={18} /></span><div><small>DISPLAY</small><strong>{snapshot.device.resolution || '1080 × 2400'}</strong><span>{preferences.gpuMode === 'auto' ? 'auto graphics' : preferences.gpuMode}</span></div><Sparkles size={16} className="stat-corner" /></div>
        <div className="stat-card"><span className="stat-icon amber"><Bot size={18} /></span><div><small>ANDROID</small><strong>{snapshot.device.androidVersion || '11'} <b>API {snapshot.device.apiLevel || '30'}</b></strong><span>{snapshot.device.model || 'Pixel 5 profile'}</span></div><span className="verified"><Check size={10} /></span></div>
      </div>

      <div className="dashboard-columns">
        <section className="panel quick-panel">
          <div className="panel-title"><div><span>SHORTCUTS</span><h3>Quick actions</h3></div><Zap size={18} /></div>
          <div className="quick-list">
            <QuickAction icon={PackagePlus} title="Install an APK" copy="Choose a package from your PC" onClick={onInstall} disabled={!running} />
            <QuickAction icon={Camera} title="Take a screenshot" copy="Save a full-resolution PNG" onClick={onScreenshot} disabled={!running} />
            <QuickAction icon={RotateCw} title="Restart device" copy="A clean, controlled reboot" onClick={onRestart} disabled={!running} />
            <QuickAction icon={FolderOpen} title="Open SDK folder" copy="Browse Android platform tools" onClick={() => void api.revealSdk()} disabled={!snapshot.sdkPath} />
          </div>
        </section>
        <section className="panel session-panel">
          <div className="panel-title"><div><span>DEVICE</span><h3>Session details</h3></div><div className={`live-ring ${running ? 'on' : ''}`}><i /></div></div>
          <dl className="session-list">
            <div><dt><Smartphone size={15} /> Virtual device</dt><dd>{snapshot.selectedAvd.replaceAll('_', ' ')}</dd></div>
            <div><dt><SquareTerminal size={15} /> ADB serial</dt><dd>{snapshot.device.serial || 'Not connected'}</dd></div>
            <div><dt><HardDrive size={15} /> SDK status</dt><dd className={snapshot.sdkPath ? 'good' : ''}>{snapshot.sdkPath ? 'Linked' : 'Not linked'}</dd></div>
            <div><dt><Clock3 size={15} /> Last checked</dt><dd>{formatTime(snapshot.updatedAt)}</dd></div>
          </dl>
          <button className="text-action" onClick={() => setPage('activity')}>View full activity <ChevronRight size={15} /></button>
        </section>
      </div>
    </>
  )
}

function AppsPage({ snapshot, apps, query, setQuery, onInstall, onLaunch, onRefresh }: { snapshot: EmulatorSnapshot; apps: InstalledApp[]; query: string; setQuery: (query: string) => void; onInstall: () => void; onLaunch: (app: InstalledApp) => void; onRefresh: () => void }): JSX.Element {
  const filtered = apps.filter((app) => `${app.label} ${app.packageName}`.toLowerCase().includes(query.toLowerCase()))
  return (
    <>
      <SectionHeader eyebrow="LIBRARY" title="Your Android apps" description="Install APKs and launch user apps without hunting through the device." actions={
        <button className="primary-small" onClick={onInstall} disabled={snapshot.state !== 'running'}><PackagePlus size={16} /> Install APK</button>
      } />
      <div className="library-toolbar">
        <label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search app or package…" /></label>
        <button className="icon-button labeled" onClick={onRefresh}><RefreshCcw size={16} /> Refresh</button>
      </div>
      {snapshot.state !== 'running' ? (
        <div className="empty-state"><div className="empty-illustration"><AppWindow size={30} /><span /></div><h3>Start Android to see your apps</h3><p>App discovery uses ADB and updates automatically once the device is online.</p></div>
      ) : filtered.length ? (
        <div className="app-grid">
          {filtered.map((app) => (
            <button className="app-card" key={app.packageName} onClick={() => onLaunch(app)}>
              <span className={`app-icon ${app.accent}`}>{app.label.slice(0, 1).toUpperCase()}</span>
              <span className="app-info"><strong>{app.label}</strong><small>{app.packageName}</small></span>
              <span className="app-open"><Play size={14} fill="currentColor" /></span>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-state"><div className="empty-illustration"><PackagePlus size={30} /><span /></div><h3>No user apps found</h3><p>Install your first APK and it will appear here.</p><button className="primary-small" onClick={onInstall}><Plus size={16} /> Choose APK</button></div>
      )}
    </>
  )
}

function KeymapPage({ keymap, setKeymap, onSave }: { keymap: KeymapState; setKeymap: (next: KeymapState) => void; onSave: () => void }): JSX.Element {
  const updateBinding = (id: string, patch: Partial<KeyBinding>): void => {
    setKeymap({ ...keymap, bindings: keymap.bindings.map((binding) => binding.id === id ? { ...binding, ...patch } : binding) })
  }
  const addBinding = (): void => {
    setKeymap({ ...keymap, bindings: [...keymap.bindings, { id: `map-${Date.now()}`, key: 'F1', label: 'New action', x: 540, y: 1200 }] })
  }
  return (
    <>
      <SectionHeader eyebrow="GAMING" title="Touch key mapping" description="Map keyboard keys to tap coordinates on the Android screen." actions={
        <button className="primary-small" onClick={onSave}><Save size={16} /> Save key map</button>
      } />
      <div className="keymap-layout">
        <section className="panel keymap-panel">
          <div className="keymap-topline">
            <div><h3>Global tap shortcuts</h3><p>Allowed: A–Z, 0–9, Space, and F1–F12.</p></div>
            <label className="toggle-row compact"><input type="checkbox" checked={keymap.enabled} onChange={(event) => setKeymap({ ...keymap, enabled: event.target.checked })} /><span className="toggle" /><strong>{keymap.enabled ? 'Enabled' : 'Disabled'}</strong></label>
          </div>
          {keymap.enabled && <div className="global-warning"><AlertTriangle size={15} />These keys are captured globally while enabled. Disable mapping before typing with them.</div>}
          <div className="mapping-table">
            <div className="mapping-head"><span>KEY</span><span>ACTION</span><span>X POSITION</span><span>Y POSITION</span><span /></div>
            {keymap.bindings.map((binding) => (
              <div className="mapping-row" key={binding.id}>
                <input className="key-input" value={binding.key} maxLength={12} onChange={(event) => updateBinding(binding.id, { key: event.target.value })} />
                <input value={binding.label} onChange={(event) => updateBinding(binding.id, { label: event.target.value })} />
                <input type="number" min={0} max={9999} value={binding.x} onChange={(event) => updateBinding(binding.id, { x: Number(event.target.value) })} />
                <input type="number" min={0} max={9999} value={binding.y} onChange={(event) => updateBinding(binding.id, { y: Number(event.target.value) })} />
                <button aria-label="Remove binding" onClick={() => setKeymap({ ...keymap, bindings: keymap.bindings.filter((item) => item.id !== binding.id) })}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
          <button className="add-mapping" onClick={addBinding}><Plus size={16} /> Add mapping</button>
        </section>
        <aside className="panel coordinates-help">
          <div className="coordinate-phone">
            <span className="coord-dot one">Q</span><span className="coord-dot two">E</span><span className="coord-dot three">SPACE</span>
            <div><Gamepad2 size={29} /><strong>1080 × 2400</strong><small>screen coordinate space</small></div>
          </div>
          <h3>How it works</h3>
          <ol><li><span>1</span>Find the screen resolution in Overview.</li><li><span>2</span>Choose the tap position for an in-game control.</li><li><span>3</span>Save and enable the map while Android is running.</li></ol>
          <div className="tip"><Info size={15} /><span>Mappings send real <code>adb shell input tap</code> commands to the active emulator.</span></div>
        </aside>
      </div>
    </>
  )
}

function ActivityPage({ logs }: { logs: ActivityLog[] }): JSX.Element {
  return (
    <>
      <SectionHeader eyebrow="DIAGNOSTICS" title="Activity & logs" description="A clear timeline of setup, device, and ADB operations." />
      <section className="panel activity-panel">
        <div className="activity-summary"><div><Activity size={19} /><span><strong>{logs.length}</strong> events this session</span></div><span className="log-retention">Latest 250 kept locally</span></div>
        <div className="log-list">
          {logs.map((log) => (
            <div className="log-row" key={log.id}>
              <span className={`log-symbol ${log.level}`}>{log.level === 'success' ? <Check size={13} /> : log.level === 'error' ? <X size={13} /> : log.level === 'warning' ? <AlertTriangle size={13} /> : <Info size={13} />}</span>
              <time>{formatTime(log.timestamp)}</time>
              <span className="log-level">{log.level}</span>
              <p>{log.message}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

function SettingsPage({ snapshot, preferences, setPreferences, onSave, onChooseSdk }: { snapshot: EmulatorSnapshot; preferences: Preferences; setPreferences: (preferences: Preferences) => void; onSave: () => void; onChooseSdk: () => void }): JSX.Element {
  const setPreset = (preset: Preferences['performancePreset']): void => {
    const values = preset === 'eco' ? { cpuCores: 2, memoryMb: 2048 } : preset === 'turbo' ? { cpuCores: 8, memoryMb: 8192 } : { cpuCores: 4, memoryMb: 4096 }
    setPreferences({ ...preferences, ...values, performancePreset: preset })
  }
  return (
    <>
      <SectionHeader eyebrow="PREFERENCES" title="Emulator settings" description="Tune launch behavior and connect your local Android SDK." actions={<button className="primary-small" onClick={onSave}><Save size={16} /> Save changes</button>} />
      <div className="settings-layout">
        <section className="settings-stack">
          <div className="panel settings-card">
            <div className="settings-heading"><span className="settings-icon"><Gauge size={19} /></span><div><h3>Performance profile</h3><p>Choose a baseline, then fine-tune resources.</p></div></div>
            <div className="preset-grid">
              {(['eco', 'balanced', 'turbo'] as const).map((preset) => (
                <button key={preset} className={preferences.performancePreset === preset ? 'active' : ''} onClick={() => setPreset(preset)}>
                  {preset === 'eco' ? <ShieldCheck size={19} /> : preset === 'turbo' ? <Zap size={19} /> : <Gauge size={19} />}
                  <strong>{preset[0].toUpperCase() + preset.slice(1)}</strong><span>{preset === 'eco' ? '2 cores · 2 GB' : preset === 'turbo' ? '8 cores · 8 GB' : '4 cores · 4 GB'}</span>
                </button>
              ))}
            </div>
            <div className="range-grid">
              <label><span><strong>CPU cores</strong><b>{preferences.cpuCores}</b></span><input type="range" min="1" max="16" value={preferences.cpuCores} onChange={(event) => setPreferences({ ...preferences, cpuCores: Number(event.target.value), performancePreset: 'custom' })} /></label>
              <label><span><strong>Memory</strong><b>{(preferences.memoryMb / 1024).toFixed(1)} GB</b></span><input type="range" min="1536" max="16384" step="512" value={preferences.memoryMb} onChange={(event) => setPreferences({ ...preferences, memoryMb: Number(event.target.value), performancePreset: 'custom' })} /></label>
            </div>
          </div>
          <div className="panel settings-card">
            <div className="settings-heading"><span className="settings-icon cyan"><Monitor size={19} /></span><div><h3>Graphics & launch</h3><p>Applied the next time the virtual device starts.</p></div></div>
            <div className="form-grid">
              <label><span>Graphics renderer</span><select value={preferences.gpuMode} onChange={(event) => setPreferences({ ...preferences, gpuMode: event.target.value as Preferences['gpuMode'] })}><option value="auto">Auto (recommended)</option><option value="host">Host GPU</option><option value="swiftshader_indirect">Software renderer</option></select></label>
              <label><span>Virtual device name</span><input value={preferences.selectedAvd} onChange={(event) => setPreferences({ ...preferences, selectedAvd: event.target.value })} /></label>
            </div>
            <div className="toggle-list">
              <label className="toggle-row"><input type="checkbox" checked={preferences.coldBoot} onChange={(event) => setPreferences({ ...preferences, coldBoot: event.target.checked })} /><span className="toggle" /><span><strong>Always cold boot</strong><small>Skip saved snapshots for a clean startup</small></span></label>
              <label className="toggle-row"><input type="checkbox" checked={preferences.muted} onChange={(event) => setPreferences({ ...preferences, muted: event.target.checked })} /><span className="toggle" /><span><strong>Mute emulator audio</strong><small>Launch Android without host audio</small></span></label>
            </div>
          </div>
        </section>
        <aside className="panel sdk-card">
          <div className="settings-heading"><span className="settings-icon green"><HardDrive size={19} /></span><div><h3>Android SDK</h3><p>Local tools directory</p></div></div>
          <div className="sdk-path"><code>{preferences.sdkPath || 'No SDK folder selected'}</code></div>
          <button className="secondary-full" onClick={onChooseSdk}><FolderOpen size={16} /> Choose SDK folder</button>
          <div className="tool-checks">
            <div className={snapshot.tools.adb ? '' : 'missing'}>{snapshot.tools.adb ? <Check size={12} /> : <X size={12} />}<span>Platform Tools / ADB</span></div>
            <div className={snapshot.tools.emulator ? '' : 'missing'}>{snapshot.tools.emulator ? <Check size={12} /> : <X size={12} />}<span>Android Emulator</span></div>
            <div className={snapshot.avds.includes(preferences.selectedAvd) ? '' : 'missing'}>{snapshot.avds.includes(preferences.selectedAvd) ? <Check size={12} /> : <X size={12} />}<span>Android 11 virtual device</span></div>
          </div>
          <div className="sdk-note"><ShieldCheck size={17} /><span>DroidDeck downloads SDK components only from <strong>dl.google.com</strong>.</span></div>
        </aside>
      </div>
    </>
  )
}

function SetupModal({ snapshot, progress, onClose, onPrepare, onChooseSdk, preparing }: { snapshot: EmulatorSnapshot; progress: SetupProgress; onClose: () => void; onPrepare: () => void; onChooseSdk: () => void; preparing: boolean }): JSX.Element {
  const done = progress.phase === 'done'
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="setup-modal" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <button className="modal-close" onClick={onClose} disabled={preparing}><X size={18} /></button>
        <div className="setup-visual"><div className="setup-orb"><Bot size={36} /></div><span className="spark s1" /><span className="spark s2" /><span className="spark s3" /></div>
        <span className="eyebrow">ONE-TIME SETUP</span>
        <h2 id="setup-title">Build your Android 11 workspace</h2>
        <p>DroidDeck will use official Google tools to create a Pixel 5 profile running Android 11 (API 30).</p>
        <div className="setup-steps">
          <div className={progress.percent >= 8 ? 'done' : ''}><span>{progress.percent >= 8 ? <Check size={13} /> : '1'}</span><div><strong>Java runtime</strong><small>Use Android Studio JBR or OpenJDK 17</small></div></div>
          <div className={progress.percent >= 22 ? 'done' : ''}><span>{progress.percent >= 22 ? <Check size={13} /> : '2'}</span><div><strong>Android command-line tools</strong><small>Downloaded securely from Google</small></div></div>
          <div className={progress.percent >= 62 ? 'done' : ''}><span>{progress.percent >= 62 ? <Check size={13} /> : '3'}</span><div><strong>Android 11 device image</strong><small>Google APIs · x86_64</small></div></div>
        </div>
        {(preparing || progress.phase === 'error' || done) && (
          <div className={`setup-progress ${progress.phase}`}><div><span style={{ width: `${progress.percent}%` }} /></div><p>{progress.phase === 'error' ? <AlertTriangle size={14} /> : done ? <Check size={14} /> : <span className="tiny-spinner" />}{progress.message}</p></div>
        )}
        <button className="setup-primary" onClick={done ? onClose : onPrepare} disabled={preparing}>{preparing ? <><span className="button-spinner" /> Preparing Android…</> : done ? <><Check size={17} /> Continue to dashboard</> : <><Download size={17} /> Set up automatically</>}</button>
        <button className="setup-secondary" onClick={onChooseSdk} disabled={preparing}><FolderOpen size={15} /> I already have an Android SDK</button>
        {snapshot.platform !== 'win32' && desktopMode && <div className="platform-warning"><AlertTriangle size={14} />Automatic setup targets Windows 10/11.</div>}
      </section>
    </div>
  )
}

export default function App(): JSX.Element {
  const [page, setPage] = useState<Page>('home')
  const [snapshot, setSnapshot] = useState<EmulatorSnapshot>(emptySnapshot)
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences)
  const [apps, setApps] = useState<InstalledApp[]>([])
  const [keymap, setKeymap] = useState<KeymapState>({ enabled: false, bindings: [] })
  const [logs, setLogs] = useState<ActivityLog[]>(initialLogs)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [setupProgress, setSetupProgress] = useState<SetupProgress>({ phase: 'idle', message: 'Ready to begin', percent: 0 })

  const running = snapshot.state === 'running'
  const needsSetup = snapshot.state === 'missing-sdk' || snapshot.state === 'needs-setup'

  useEffect(() => {
    void Promise.all([api.getSnapshot(), api.getPreferences(), api.getKeymap()]).then(([nextSnapshot, nextPreferences, nextKeymap]) => {
      setSnapshot(nextSnapshot)
      setPreferences(nextPreferences)
      setKeymap(nextKeymap)
    })
    const removeSnapshot = api.onSnapshot(setSnapshot)
    const removeLog = api.onLog((log) => setLogs((current) => [log, ...current].slice(0, 250)))
    const removeProgress = api.onSetupProgress(setSetupProgress)
    return () => { removeSnapshot(); removeLog(); removeProgress() }
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3_200)
    return () => clearTimeout(timer)
  }, [toast])

  const loadApps = async (): Promise<void> => {
    const result = await api.listApps()
    if (result.data) setApps(result.data)
  }

  useEffect(() => {
    if (running) void loadApps()
  }, [running])

  const showResult = (result: OperationResult<unknown>): void => {
    setToast({ message: result.message, kind: result.ok ? 'success' : 'error' })
  }

  const run = async (name: string, operation: () => Promise<OperationResult<unknown>>): Promise<void> => {
    setBusy(name)
    try { showResult(await operation()) } catch (cause) { setToast({ message: cause instanceof Error ? cause.message : String(cause), kind: 'error' }) }
    finally { setBusy(null) }
  }

  const primary = (): void => {
    if (needsSetup) { setSetupOpen(true); return }
    void run('primary', running ? api.stopEmulator : api.startEmulator)
  }

  const prepare = async (): Promise<void> => {
    setBusy('setup')
    setSetupProgress({ phase: 'java', message: 'Starting setup…', percent: 5 })
    const result = await api.prepareAndroid()
    showResult(result)
    if (result.ok) setSnapshot(await api.getSnapshot())
    setBusy(null)
  }

  const chooseSdk = async (): Promise<void> => {
    const result = await api.chooseSdk()
    showResult(result)
    if (result.ok && result.data) {
      setPreferences({ ...preferences, sdkPath: result.data })
      setSnapshot(await api.getSnapshot())
    }
  }

  const pageContent = useMemo(() => {
    if (page === 'apps') return <AppsPage snapshot={snapshot} apps={apps} query={query} setQuery={setQuery} onInstall={() => void run('install', api.installApk)} onLaunch={(app) => void run(`launch-${app.packageName}`, () => api.launchApp(app.packageName))} onRefresh={() => void loadApps()} />
    if (page === 'keymap') return <KeymapPage keymap={keymap} setKeymap={setKeymap} onSave={() => void run('keymap', async () => { const result = await api.saveKeymap(keymap); if (result.data) setKeymap(result.data); return result })} />
    if (page === 'activity') return <ActivityPage logs={logs} />
    if (page === 'settings') return <SettingsPage snapshot={snapshot} preferences={preferences} setPreferences={setPreferences} onSave={() => void run('settings', async () => { const result = await api.savePreferences(preferences); if (result.data) setPreferences(result.data); return result })} onChooseSdk={() => void chooseSdk()} />
    return <HomePage snapshot={snapshot} preferences={preferences} busy={busy} onPrimary={primary} onRestart={() => void run('restart', api.restartEmulator)} onInstall={() => void run('install', api.installApk)} onScreenshot={() => void run('screenshot', api.takeScreenshot)} onOpenSetup={() => setSetupOpen(true)} setPage={setPage} />
  }, [page, snapshot, preferences, apps, query, keymap, logs, busy])

  return (
    <div className="app-shell">
      <TitleBar />
      <div className="app-body">
        <Sidebar page={page} setPage={setPage} state={snapshot.state} />
        <main className="main-content"><div className="content-inner">{pageContent}</div></main>
      </div>
      {toast && <div className={`toast ${toast.kind}`}>{toast.kind === 'success' ? <Check size={16} /> : toast.kind === 'error' ? <AlertTriangle size={16} /> : <Info size={16} />}<span>{toast.message}</span><button onClick={() => setToast(null)}><X size={14} /></button></div>}
      {setupOpen && <SetupModal snapshot={snapshot} progress={setupProgress} onClose={() => setSetupOpen(false)} onPrepare={() => void prepare()} onChooseSdk={() => void chooseSdk()} preparing={busy === 'setup'} />}
    </div>
  )
}
