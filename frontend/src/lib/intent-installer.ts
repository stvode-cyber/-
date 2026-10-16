import { registerPlugin } from '@capacitor/core'

/**
 * 前端 → Android IntentInstallerPlugin 桥
 *
 * 用法：
 *   import { IntentInstaller } from './lib/intent-installer'
 *   const r = await IntentInstaller.install({ path: '/data/data/.../update.apk' })
 */

export interface InstallResult {
  success: boolean
}

export interface IntentInstallerPlugin {
  install(options: { path: string }): Promise<InstallResult>
  openUrl(options: { url: string }): Promise<InstallResult>
}

export const IntentInstaller = registerPlugin<IntentInstallerPlugin>('IntentInstaller')
