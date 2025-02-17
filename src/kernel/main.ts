import type {
  SaveWorldInfoData,
  WorldInfoFileData,
} from '../types/data/advanced-mode/world-info'
import type {
  AccountBasicInfo,
  AccountData,
  AccountDataList,
  AccountList,
} from '../types/accounts'
import type { AuthenticationByDeviceProperties } from '../types/authentication'
import type { AutomationServiceActionConfig } from '../types/automation'
import type { GroupRecord } from '../types/groups'
import type { Settings } from '../types/settings'
import type { TagRecord } from '../types/tags'
import type {
  XPBoostsConsumePersonalData,
  XPBoostsConsumeTeammateData,
  XPBoostsSearchUserConfig,
} from '../types/xpboosts'

import path from 'node:path'
import relativeTime from 'dayjs/plugin/relativeTime'
import dayjs from 'dayjs'
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import schedule from 'node-schedule'

import { ElectronAPIEventKeys } from '../config/constants/main-process'

import { AntiCheatProvider } from './core/anti-cheat-provider'
import { Authentication } from './core/authentication'
import { ClaimRewards } from './core/claim-rewards'
import { FortniteLauncher } from './core/launcher'
import { MCPClientQuestLogin, MCPHomebaseName } from './core/mcp'
import { MatchmakingTrack } from './core/matchmaking-track'
import { Manifest } from './core/manifest'
import { Party } from './core/party'
import { XPBoostsManager } from './core/xpboosts'
import { WorldInfoManager } from './core/world-info'
import { MainWindow } from './startup/windows/main'
import { AccountsManager } from './startup/accounts'
import { Application } from './startup/application'
import { AutoPinUrns } from './startup/auto-pin-urns'
import { Automation } from './startup/automation'
import { DataDirectory } from './startup/data-directory'
import { GroupsManager } from './startup/groups'
import { SettingsManager } from './startup/settings'
import { SystemTray } from './startup/system-tray'
import { TagsManager } from './startup/tags'
import { DevicesAuthManager } from './core/devices-auth'

dayjs.extend(relativeTime)

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit()
}

async function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    center: true,
    frame: false,
    height: 600,
    width: 800,
    minHeight: 400,
    minWidth: 600,
    webPreferences: {
      devTools: !app.isPackaged,
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: false,
    },
  })

  const manifest = Manifest.getData()

  if (manifest) {
    mainWindow.webContents.setUserAgent(manifest.UserAgent)
  }

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools({
      mode: 'undocked',
    })

    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    await mainWindow.loadFile(
      path.join(
        __dirname,
        `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`
      )
    )
  }

  return mainWindow
}

function cleanup() {
  MainWindow.instance.removeAllListeners()

  Automation.getProcesses().forEach((accountProcess) => {
    accountProcess.clearMissionIntervalId()
  })
  Automation.getServices().forEach((accountService) => {
    accountService.destroy()
  })
  schedule.gracefulShutdown().catch(() => {})
}

function closeApp() {
  if (process.platform !== 'darwin') {
    cleanup()
    app.quit()
  }
}

Menu.setApplicationMenu(null)

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', async () => {
  await DataDirectory.createDataResources()

  MainWindow.setInstance(await createWindow())

  /**
   * Paths
   */

  ipcMain.on(ElectronAPIEventKeys.GetMatchmakingTrackPath, async () => {
    MainWindow.instance.webContents.send(
      ElectronAPIEventKeys.GetMatchmakingTrackPathNotification,
      DataDirectory.matchmakingFilePath
    )
  })

  /**
   * Settings
   */

  ipcMain.on(ElectronAPIEventKeys.RequestAccounts, async () => {
    await AccountsManager.load()
  })

  ipcMain.on(ElectronAPIEventKeys.RequestSettings, async () => {
    await SettingsManager.load()
  })

  ipcMain.on(ElectronAPIEventKeys.RequestTags, async () => {
    await TagsManager.load()
  })

  ipcMain.on(ElectronAPIEventKeys.RequestGroups, async () => {
    await GroupsManager.load()
  })

  ipcMain.on(
    ElectronAPIEventKeys.UpdateSettings,
    async (_, settings: Settings) => {
      await SettingsManager.update(settings)
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.UpdateTags,
    async (_, tags: TagRecord) => {
      await TagsManager.update(tags)
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.UpdateGroups,
    async (_, groups: GroupRecord) => {
      await GroupsManager.update(groups)
    }
  )

  /**
   * General Methods
   */

  ipcMain.on(ElectronAPIEventKeys.OpenExternalURL, (_, url: string) => {
    shell.openExternal(url)
  })

  ipcMain.on(ElectronAPIEventKeys.CloseWindow, () => {
    if (SystemTray.isActive) {
      closeApp()
    } else {
      MainWindow.instance.close()
    }
  })

  ipcMain.on(ElectronAPIEventKeys.MinimizeWindow, () => {
    if (SystemTray.isActive) {
      MainWindow.instance.hide()
    } else {
      MainWindow.instance.minimize()
    }
  })

  /**
   * Events
   */

  ipcMain.on(
    ElectronAPIEventKeys.OnRemoveAccount,
    async (_, accountId: string) => {
      await AccountsManager.remove(accountId)
    }
  )

  /**
   * Requests
   */

  // ipcMain.on(
  //   ElectronAPIEventKeys.RequestProviderAndAccessTokenOnStartup,
  //   async (_, account: AccountData) => {
  //     const response = await AntiCheatProvider.request(account)

  //     MainWindow.instance.webContents.send(
  //       ElectronAPIEventKeys.ResponseProviderAndAccessTokenOnStartup,
  //       response
  //     )
  //   }
  // )

  /**
   * Authentication
   */

  ipcMain.on(
    ElectronAPIEventKeys.CreateAuthWithExchange,
    async (_, code: string) => {
      await Authentication.exchange(code)
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.CreateAuthWithAuthorization,
    async (_, code: string) => {
      await Authentication.authorization(code)
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.CreateAuthWithDevice,
    async (_, data: AuthenticationByDeviceProperties) => {
      await Authentication.device(data)
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.OpenEpicGamesSettings,
    async (_, account: AccountData) => {
      await Authentication.openEpicGamesSettings(account)
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.GenerateExchangeCode,
    async (_, account: AccountData) => {
      await Authentication.generateExchangeCode(account)
    }
  )

  ipcMain.on(ElectronAPIEventKeys.RequestNewVersionStatus, async () => {
    await Application.checkVersion()
  })

  /**
   * Launcher
   */

  ipcMain.on(
    ElectronAPIEventKeys.LauncherStart,
    async (_, account: AccountData) => {
      await FortniteLauncher.start(account)
    }
  )

  /**
   * STW Operations
   */

  ipcMain.on(
    ElectronAPIEventKeys.SetSaveQuests,
    async (_, accounts: Array<AccountData>) => {
      await MCPClientQuestLogin.save(accounts)
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.SetHombaseName,
    async (_, accounts: Array<AccountData>, homebaseName: string) => {
      await MCPHomebaseName.update(accounts, homebaseName)
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.XPBoostsAccountProfileRequest,
    async (_, accounts: Array<AccountData>) => {
      await XPBoostsManager.requestAccounts(accounts)
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.XPBoostsConsumePersonal,
    async (_, data: XPBoostsConsumePersonalData) => {
      await XPBoostsManager.consumePersonal(data)
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.XPBoostsConsumeTeammate,
    async (_, data: XPBoostsConsumeTeammateData) => {
      await XPBoostsManager.consumeTeammate(data)
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.XPBoostsSearchUser,
    async (_, config: XPBoostsSearchUserConfig) => {
      await XPBoostsManager.searchUser(
        ElectronAPIEventKeys.XPBoostsSearchUserNotification,
        config
      )
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.XPBoostsGeneralSearchUser,
    async (_, config: XPBoostsSearchUserConfig) => {
      await XPBoostsManager.generalSearchUser(config)
    }
  )

  /**
   * Party
   */

  ipcMain.on(
    ElectronAPIEventKeys.PartyClaimAction,
    async (_, selectedAccount: Array<AccountData>) => {
      await ClaimRewards.start(selectedAccount)
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.PartyKickAction,
    async (
      _,
      selectedAccount: AccountData,
      accounts: AccountDataList,
      claimState: boolean
    ) => {
      await Party.kickPartyMembers(selectedAccount, accounts, claimState, {
        force: true,
      })
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.PartyLeaveAction,
    async (
      _,
      selectedAccounts: AccountList,
      accounts: AccountDataList,
      claimState: boolean
    ) => {
      await Party.leaveParty(selectedAccounts, accounts, claimState)
    }
  )

  ipcMain.on(ElectronAPIEventKeys.PartyLoadFriends, async () => {
    await Party.loadFriends()
  })

  ipcMain.on(
    ElectronAPIEventKeys.PartyAddNewFriendAction,
    async (_, account: AccountData, displayName: string) => {
      await Party.addNewFriend(account, displayName)
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.PartyInviteAction,
    async (_, account: AccountData, accountIds: Array<string>) => {
      await Party.invite(account, accountIds)
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.PartyRemoveFriendAction,
    async (
      _,
      data: {
        accountId: string
        displayName: string
      }
    ) => {
      await Party.removeFriend(data)
    }
  )

  /**
   * Advanced Mode
   */

  ipcMain.on(ElectronAPIEventKeys.WorldInfoRequestData, async () => {
    await WorldInfoManager.requestData()
  })

  ipcMain.on(
    ElectronAPIEventKeys.WorldInfoSaveFile,
    async (_, data: SaveWorldInfoData) => {
      await WorldInfoManager.saveFile(data)
    }
  )

  ipcMain.on(ElectronAPIEventKeys.WorldInfoRequestFiles, async () => {
    await WorldInfoManager.requestFiles()
  })

  ipcMain.on(
    ElectronAPIEventKeys.WorldInfoDeleteFile,
    async (_, data: WorldInfoFileData) => {
      await WorldInfoManager.deleteFile(data)
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.WorldInfoExportFile,
    async (_, data: WorldInfoFileData) => {
      await WorldInfoManager.exportWorldInfoFile(data)
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.WorldInfoOpenFile,
    async (_, data: WorldInfoFileData) => {
      await WorldInfoManager.openWorldInfoFile(data)
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.WorldInfoRenameFile,
    async (_, data: WorldInfoFileData, newFilename: string) => {
      await WorldInfoManager.renameFile(data, newFilename)
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.MatchmakingTrackSaveFile,
    async (_, account: AccountData, accountId: string) => {
      await MatchmakingTrack.saveFile(account, accountId)
    }
  )

  /**
   * Automation
   */

  ipcMain.on(
    ElectronAPIEventKeys.AutomationServiceRequestData,
    async () => {
      await Automation.load()
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.AutomationServiceStart,
    async (_, accountId: string) => {
      await Automation.addAccount(accountId)
    }
  )

  // ipcMain.on(
  //   ElectronAPIEventKeys.AutomationServiceReload,
  //   async (_, accountId: string) => {
  //     await Automation.reload(accountId)
  //   }
  // )

  ipcMain.on(
    ElectronAPIEventKeys.AutomationServiceRemove,
    async (_, accountId: string) => {
      await Automation.removeAccount(accountId)
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.AutomationServiceActionUpdate,
    async (
      _,
      accountId: string,
      config: AutomationServiceActionConfig
    ) => {
      await Automation.updateAction(accountId, config)
    }
  )

  /**
   * Urns
   */

  ipcMain.on(ElectronAPIEventKeys.UrnsServiceRequestData, async () => {
    await AutoPinUrns.load()
  })

  ipcMain.on(
    ElectronAPIEventKeys.UrnsServiceAdd,
    async (_, accountId: string) => {
      await AutoPinUrns.addAccount(accountId)
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.UrnsServiceUpdate,
    async (_, accountId: string, value: boolean) => {
      await AutoPinUrns.updateAccount(accountId, value)
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.UrnsServiceRemove,
    async (_, accountId: string) => {
      await AutoPinUrns.removeAccount(accountId)
    }
  )

  /**
   * Accounts
   */

  ipcMain.on(
    ElectronAPIEventKeys.UpdateAccountBasicInfo,
    async (_, account: AccountBasicInfo) => {
      await AccountsManager.add(account)
      MainWindow.instance.webContents.send(
        ElectronAPIEventKeys.ResponseUpdateAccountBasicInfo
      )
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.DevicesAuthRequestData,
    async (_, account: AccountData) => {
      await DevicesAuthManager.load(account)
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.DevicesAuthRemove,
    async (_, account: AccountData, deviceId: string) => {
      await DevicesAuthManager.remove(account, deviceId)
    }
  )

  /**
   * Schedules
   */

  schedule.scheduleJob(
    {
      /**
       * Executes in every reset at time: 00:00:05 AM
       * Hour: 00
       * Minute: 00
       * Second: 05
       */
      rule: '5 0 0 * * *',
      /**
       * Time zone
       */
      tz: 'UTC',
    },
    () => {
      // MainWindow.instance.webContents.send(
      //   ElectronAPIEventKeys.ScheduleRequestAccounts
      // )

      WorldInfoManager.requestData()
    }
  )

  ipcMain.on(
    ElectronAPIEventKeys.ScheduleResponseAccounts,
    (_, accounts: Array<AccountData>) => {
      AntiCheatProvider.requestBulk(accounts)
    }
  )
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (!SystemTray.isActive) {
    closeApp()
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
