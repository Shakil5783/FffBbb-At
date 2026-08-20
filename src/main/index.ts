import { app, BrowserWindow, dialog, globalShortcut, ipcMain, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AndroidService } from './android-service'
import type { KeymapState, Preferences } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let service: AndroidService
let refreshTimer: NodeJS.Timeout | null = null
let keymapFile = ''
let keymap: KeymapState = {
  enabled: false,
  bindings: [
    { id: 'skill-1', key: 'Q', label: 'Skill 1', x: 860, y: 2050 },
    { id: 'skill-2', key: 'E', label: 'Skill 2', x: 980, y: 1910 },
    { id: 'action', key: 'Space', label: 'Primary action', x: 890, y: 2200 }
  ]
}

function setupScriptPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'scripts', 'setup-android.ps1')
    : join(process.cwd(), 'scripts', 'setup-android.ps1')
}

function loadKeymap(): void {
  try {
    if (existsSync(keymapFile)) keymap = JSON.parse(readFileSync(keymapFile, 'utf8')) as KeymapState
  } catch {
    // Keep the safe defaults when a previous file cannot be parsed.
  }
}

function applyKeymap(next: KeymapState): { ok: boolean; message: string; data: KeymapState } {
  globalShortcut.unregisterAll()
  const safeBindings = next.bindings.slice(0, 24).map((binding, index) => ({
    id: String(binding.id || `binding-${index}`).slice(0, 80),
    key: String(binding.key || '').trim().slice(0, 12),
    label: String(binding.label || `Action ${index + 1}`).trim().slice(0, 40),
    x: Math.min(9999, Math.max(0, Math.round(Number(binding.x) || 0))),
    y: Math.min(9999, Math.max(0, Math.round(Number(binding.y) || 0)))
  })).filter((binding) => /^(?:[A-Z0-9]|Space|F(?:[1-9]|1[0-2]))$/i.test(binding.key))

  keymap = { enabled: Boolean(next.enabled), bindings: safeBindings }
  writeFileSync(keymapFile, JSON.stringify(keymap, null, 2), 'utf8')

  const failed: string[] = []
  if (keymap.enabled) {
    for (const binding of keymap.bindings) {
      const registered = globalShortcut.register(binding.key, () => service.sendTap(binding.x, binding.y))
      if (!registered) failed.push(binding.key)
    }
  }
  const message = failed.length
    ? `Saved, but these keys are unavailable: ${failed.join(', ')}`
    : keymap.enabled
      ? `${keymap.bindings.length} global tap mappings enabled`
      : 'Key mapping disabled'
  return { ok: failed.length === 0, message, data: keymap }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    frame: false,
    backgroundColor: '#090b11',
    title: 'DroidDeck 11',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('droiddeck:get-snapshot', () => service.refresh())
  ipcMain.handle('droiddeck:get-preferences', () => service.getPreferences())
  ipcMain.handle('droiddeck:save-preferences', (_event, preferences: Preferences) =>
    service.savePreferences(preferences)
  )

  ipcMain.handle('droiddeck:choose-sdk', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose Android SDK folder',
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, message: 'No folder selected', data: null }
    }
    return service.setSdkPath(result.filePaths[0])
  })

  ipcMain.handle('droiddeck:prepare', () => service.prepareAndroid())
  ipcMain.handle('droiddeck:start', () => service.start())
  ipcMain.handle('droiddeck:stop', () => service.stop())
  ipcMain.handle('droiddeck:restart', () => service.restart())

  ipcMain.handle('droiddeck:install-apk', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Install an APK',
      buttonLabel: 'Install APK',
      properties: ['openFile'],
      filters: [{ name: 'Android packages', extensions: ['apk'] }]
    })
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, message: 'No APK selected' }
    }
    return service.installApk(result.filePaths[0])
  })

  ipcMain.handle('droiddeck:screenshot', async () => {
    const now = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save emulator screenshot',
      defaultPath: join(app.getPath('pictures'), `DroidDeck-${now}.png`),
      filters: [{ name: 'PNG image', extensions: ['png'] }]
    })
    if (result.canceled || !result.filePath) {
      return { ok: false, message: 'Screenshot canceled' }
    }
    return service.takeScreenshot(result.filePath)
  })

  ipcMain.handle('droiddeck:list-apps', () => service.listApps())
  ipcMain.handle('droiddeck:launch-app', (_event, packageName: string) => service.launchApp(packageName))
  ipcMain.handle('droiddeck:get-keymap', () => keymap)
  ipcMain.handle('droiddeck:save-keymap', (_event, next: KeymapState) => applyKeymap(next))
  ipcMain.handle('droiddeck:reveal-sdk', async () => {
    const sdkPath = (await service.refresh()).sdkPath
    if (!sdkPath) return { ok: false, message: 'No Android SDK is linked' }
    const error = await shell.openPath(sdkPath)
    return error ? { ok: false, message: error } : { ok: true, message: 'SDK folder opened' }
  })
  ipcMain.handle('droiddeck:open-external', (_event, url: string) => {
    if (/^https:\/\//i.test(url)) return shell.openExternal(url)
    return undefined
  })

  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())

  service.on('snapshot', (snapshot) => mainWindow?.webContents.send('droiddeck:snapshot', snapshot))
  service.on('log', (log) => mainWindow?.webContents.send('droiddeck:log', log))
  service.on('progress', (progress) => mainWindow?.webContents.send('droiddeck:progress', progress))
}

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    const userDataPath = app.getPath('userData')
    service = new AndroidService(userDataPath, setupScriptPath())
    keymapFile = join(userDataPath, 'keymap.json')
    loadKeymap()
    applyKeymap(keymap)
    registerIpc()
    createWindow()
    void service.refresh()
    refreshTimer = setInterval(() => void service.refresh(), 5_000)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('window-all-closed', () => {
  if (refreshTimer) clearInterval(refreshTimer)
  app.quit()
})
