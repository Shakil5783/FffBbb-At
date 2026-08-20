import { contextBridge, ipcRenderer } from 'electron'
import type {
  ActivityLog,
  DroidDeckApi,
  EmulatorSnapshot,
  Preferences,
  SetupProgress
} from '../shared/types'

const api: DroidDeckApi = {
  getSnapshot: () => ipcRenderer.invoke('droiddeck:get-snapshot'),
  getPreferences: () => ipcRenderer.invoke('droiddeck:get-preferences'),
  savePreferences: (preferences: Preferences) => ipcRenderer.invoke('droiddeck:save-preferences', preferences),
  chooseSdk: () => ipcRenderer.invoke('droiddeck:choose-sdk'),
  prepareAndroid: () => ipcRenderer.invoke('droiddeck:prepare'),
  startEmulator: () => ipcRenderer.invoke('droiddeck:start'),
  stopEmulator: () => ipcRenderer.invoke('droiddeck:stop'),
  restartEmulator: () => ipcRenderer.invoke('droiddeck:restart'),
  installApk: () => ipcRenderer.invoke('droiddeck:install-apk'),
  takeScreenshot: () => ipcRenderer.invoke('droiddeck:screenshot'),
  listApps: () => ipcRenderer.invoke('droiddeck:list-apps'),
  launchApp: (packageName) => ipcRenderer.invoke('droiddeck:launch-app', packageName),
  getKeymap: () => ipcRenderer.invoke('droiddeck:get-keymap'),
  saveKeymap: (keymap) => ipcRenderer.invoke('droiddeck:save-keymap', keymap),
  revealSdk: () => ipcRenderer.invoke('droiddeck:reveal-sdk'),
  openExternal: (url: string) => ipcRenderer.invoke('droiddeck:open-external', url),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  onSnapshot: (callback: (snapshot: EmulatorSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: EmulatorSnapshot): void => callback(snapshot)
    ipcRenderer.on('droiddeck:snapshot', listener)
    return () => ipcRenderer.removeListener('droiddeck:snapshot', listener)
  },
  onLog: (callback: (log: ActivityLog) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, log: ActivityLog): void => callback(log)
    ipcRenderer.on('droiddeck:log', listener)
    return () => ipcRenderer.removeListener('droiddeck:log', listener)
  },
  onSetupProgress: (callback: (progress: SetupProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: SetupProgress): void => callback(progress)
    ipcRenderer.on('droiddeck:progress', listener)
    return () => ipcRenderer.removeListener('droiddeck:progress', listener)
  }
}

contextBridge.exposeInMainWorld('droiddeck', api)
