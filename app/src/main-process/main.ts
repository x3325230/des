import '../lib/logging/main/install'

import { app, Menu, ipcMain, BrowserWindow, shell } from 'electron'
import * as Fs from 'fs'

import { MenuLabelsEvent } from '../models/menu-labels'

import { AppWindow } from './app-window'
import { buildDefaultMenu, MenuEvent, getAllMenuItems } from './menu'
import { shellNeedsPatching, updateEnvironmentForProcess } from '../lib/shell'
import { parseAppURL } from '../lib/parse-app-url'
import { handleSquirrelEvent } from './squirrel-updater'
import { fatalError } from '../lib/fatal-error'

import { IMenuItemState } from '../lib/menu-update'
import { LogLevel } from '../lib/logging/log-level'
import { log as writeLog } from './log'
import { openDirectorySafe } from './shell'
import { reportError } from './exception-reporting'
import {
  enableSourceMaps,
  withSourceMappedStack,
} from '../lib/source-map-support'
import { now } from './now'
import { showUncaughtException } from './show-uncaught-exception'
import { IMenuItem } from '../lib/menu-item'
import { buildContextMenu } from './menu/build-context-menu'

enableSourceMaps()

let mainWindow: AppWindow | null = null

const launchTime = now()

let preventQuit = false
let readyTime: number | null = null

type OnDidLoadFn = (window: AppWindow) => void
/** See the `onDidLoad` function. */
let onDidLoadFns: Array<OnDidLoadFn> | null = []

function handleUncaughtException(error: Error) {
  preventQuit = true

  // If we haven't got a window we'll assume it's because
  // we've just launched and haven't created it yet.
  // It could also be because we're encountering an unhandled
  // exception on shutdown but that's less likely and since
  // this only affects the presentation of the crash dialog
  // it's a safe assumption to make.
  const isLaunchError = mainWindow === null

  if (mainWindow) {
    mainWindow.destroy()
    mainWindow = null
  }

  showUncaughtException(isLaunchError, error)
}

/**
 * Calculates the number of seconds the app has been running
 */
function getUptimeInSeconds() {
  return (now() - launchTime) / 1000
}

function getExtraErrorContext(): Record<string, string> {
  return {
    uptime: getUptimeInSeconds().toFixed(3),
    time: new Date().toString(),
  }
}

process.on('uncaughtException', (error: Error) => {
  error = withSourceMappedStack(error)
  reportError(error, getExtraErrorContext())
  handleUncaughtException(error)
})

let handlingSquirrelEvent = false
if (__WIN32__ && process.argv.length > 1) {
  const arg = process.argv[1]

  const promise = handleSquirrelEvent(arg)
  if (promise) {
    handlingSquirrelEvent = true
    promise
      .catch(e => {
        log.error(`Failed handling Squirrel event: ${arg}`, e)
      })
      .then(() => {
        app.quit()
      })
  } else {
    handlePossibleProtocolLauncherArgs(process.argv)
  }
}

function handleAppURL(url: string) {
  log.info('Processing protocol url')
  const action = parseAppURL(url)
  onDidLoad(window => {
    // This manual focus call _shouldn't_ be necessary, but is for Chrome on
    // macOS. See https://github.com/desktop/desktop/issues/973.
    window.focus()
    window.sendURLAction(action)
  })
}

let isDuplicateInstance = false
// If we're handling a Squirrel event we don't want to enforce single instance.
// We want to let the updated instance launch and do its work. It will then quit
// once it's done.
if (!handlingSquirrelEvent) {
  const gotSingleInstanceLock = app.requestSingleInstanceLock()
  isDuplicateInstance = !gotSingleInstanceLock

  app.on('second-instance', (event, args, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }

      if (!mainWindow.isVisible()) {
        mainWindow.show()
      }

      mainWindow.focus()
    }

    handlePossibleProtocolLauncherArgs(args)
  })

  if (isDuplicateInstance) {
    app.quit()
  }
}

if (shellNeedsPatching(process)) {
  updateEnvironmentForProcess()
}

app.on('will-finish-launching', () => {
  // macOS only
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleAppURL(url)
  })
})

if (__DARWIN__) {
  app.on('open-file', async (event, path) => {
    event.preventDefault()

    log.info(`[main] a path to ${path} was triggered`)

    Fs.stat(path, (err, stats) => {
      if (err) {
        log.error(`Unable to open path '${path}' in Desktop`, err)
        return
      }

      if (stats.isFile()) {
        log.warn(
          `A file at ${path} was dropped onto Desktop, but it can only handle folders. Ignoring this action.`
        )
        return
      }

      handleAppURL(
        `x-github-client://openLocalRepo/${encodeURIComponent(path)}`
      )
    })
  })
}

/**
 * Attempt to detect and handle any protocol handler arguments passed
 * either via the command line directly to the current process or through
 * IPC from a duplicate instance (see makeSingleInstance)
 *
 * @param args Essentially process.argv, i.e. the first element is the exec
 *             path
 */
function handlePossibleProtocolLauncherArgs(args: ReadonlyArray<string>) {
  log.info(`Received possible protocol arguments: ${args.length}`)

  if (__WIN32__) {
    // Desktop registers it's protocol handler callback on Windows as
    // `[executable path] --protocol-launcher "%1"`. At launch it checks
    // for that exact scenario here before doing any processing, and only
    // processing the first argument. If there's more than 3 args because of a
    // malformed or untrusted url then we bail out.
    if (args.length === 3 && args[1] === '--protocol-launcher') {
      handleAppURL(args[2])
    }
  } else if (args.length > 1) {
    handleAppURL(args[1])
  }
}

/**
 * Wrapper around app.setAsDefaultProtocolClient that adds our
 * custom prefix command line switches on Windows.
 */
function setAsDefaultProtocolClient(protocol: string) {
  if (__WIN32__) {
    app.setAsDefaultProtocolClient(protocol, process.execPath, [
      '--protocol-launcher',
    ])
  } else {
    app.setAsDefaultProtocolClient(protocol)
  }
}

if (process.env.GITHUB_DESKTOP_DISABLE_HARDWARE_ACCELERATION) {
  log.info(
    `GITHUB_DESKTOP_DISABLE_HARDWARE_ACCELERATION environment variable set, disabling hardware acceleration`
  )
  app.disableHardwareAcceleration()
}

app.on('ready', () => {
  if (isDuplicateInstance || handlingSquirrelEvent) {
    return
  }

  readyTime = now() - launchTime

  setAsDefaultProtocolClient('x-github-client')

  if (__DEV__) {
    setAsDefaultProtocolClient('x-github-desktop-dev-auth')
  } else {
    setAsDefaultProtocolClient('x-github-desktop-auth')
  }

  // Also support Desktop Classic's protocols.
  if (__DARWIN__) {
    setAsDefaultProtocolClient('github-mac')
  } else if (__WIN32__) {
    setAsDefaultProtocolClient('github-windows')
  }

  createWindow()

  Menu.setApplicationMenu(
    buildDefaultMenu({
      selectedShell: null,
      selectedExternalEditor: null,
      askForConfirmationOnRepositoryRemoval: false,
      askForConfirmationOnForcePush: false,
    })
  )

  ipcMain.on(
    'update-preferred-app-menu-item-labels',
    (event: Electron.IpcMessageEvent, labels: MenuLabelsEvent) => {
      // The current application menu is mutable and we frequently
      // change whether particular items are enabled or not through
      // the update-menu-state IPC event. This menu that we're creating
      // now will have all the items enabled so we need to merge the
      // current state with the new in order to not get a temporary
      // race conditions where menu items which shouldn't be enabled
      // are.
      const newMenu = buildDefaultMenu(labels)

      const currentMenu = Menu.getApplicationMenu()

      // This shouldn't happen but whenever one says that it does
      // so here's the escape hatch when we can't merge the current
      // menu with the new one; we just use the new one.
      if (currentMenu === null) {
        // https://github.com/electron/electron/issues/2717
        Menu.setApplicationMenu(newMenu)

        if (mainWindow !== null) {
          mainWindow.sendAppMenu()
        }

        return
      }

      // It's possible that after rebuilding the menu we'll end up
      // with the exact same structural menu as we had before so we
      // keep track of whether anything has actually changed in order
      // to avoid updating the global menu and telling the renderer
      // about it.
      let menuHasChanged = false

      for (const newItem of getAllMenuItems(newMenu)) {
        // Our menu items always have ids and Electron.MenuItem takes on whatever
        // properties was defined on the MenuItemOptions template used to create it
        // but doesn't surface those in the type declaration.
        const id = (newItem as any).id

        if (!id) {
          continue
        }

        const currentItem = currentMenu.getMenuItemById(id)

        // Unfortunately the type information for getMenuItemById
        // doesn't specify if it'll return null or undefined when
        // the item doesn't exist so we'll do a falsy check here.
        if (!currentItem) {
          menuHasChanged = true
        } else {
          if (currentItem.label !== newItem.label) {
            menuHasChanged = true
          }

          // Copy the enabled property from the existing menu
          // item since it'll be the most recent reflection of
          // what the renderer wants.
          if (currentItem.enabled !== newItem.enabled) {
            newItem.enabled = currentItem.enabled
            menuHasChanged = true
          }
        }
      }

      if (menuHasChanged && mainWindow) {
        // https://github.com/electron/electron/issues/2717
        Menu.setApplicationMenu(newMenu)
        mainWindow.sendAppMenu()
      }
    }
  )

  ipcMain.on('menu-event', (event: Electron.IpcMessageEvent, args: any[]) => {
    const { name }: { name: MenuEvent } = event as any
    if (mainWindow) {
      mainWindow.sendMenuEvent(name)
    }
  })

  /**
   * An event sent by the renderer asking that the menu item with the given id
   * is executed (ie clicked).
   */
  ipcMain.on(
    'execute-menu-item',
    (event: Electron.IpcMessageEvent, { id }: { id: string }) => {
      const currentMenu = Menu.getApplicationMenu()

      if (currentMenu === null) {
        return
      }

      const menuItem = currentMenu.getMenuItemById(id)
      if (menuItem) {
        const window = BrowserWindow.fromWebContents(event.sender)
        const fakeEvent = { preventDefault: () => {}, sender: event.sender }
        menuItem.click(fakeEvent, window, event.sender)
      }
    }
  )

  ipcMain.on(
    'update-menu-state',
    (
      event: Electron.IpcMessageEvent,
      items: Array<{ id: string; state: IMenuItemState }>
    ) => {
      let sendMenuChangedEvent = false

      for (const item of items) {
        const { id, state } = item

        const currentMenu = Menu.getApplicationMenu()

        if (currentMenu === null) {
          return
        }

        const menuItem = currentMenu.getMenuItemById(id)

        if (menuItem) {
          // Only send the updated app menu when the state actually changes
          // or we might end up introducing a never ending loop between
          // the renderer and the main process
          if (
            state.enabled !== undefined &&
            menuItem.enabled !== state.enabled
          ) {
            menuItem.enabled = state.enabled
            sendMenuChangedEvent = true
          }
        } else {
          fatalError(`Unknown menu id: ${id}`)
        }
      }

      if (sendMenuChangedEvent && mainWindow) {
        mainWindow.sendAppMenu()
      }
    }
  )

  ipcMain.on(
    'show-contextual-menu',
    (event: Electron.IpcMessageEvent, items: ReadonlyArray<IMenuItem>) => {
      const menu = buildContextMenu(items, ix =>
        event.sender.send('contextual-menu-action', ix)
      )

      const window = BrowserWindow.fromWebContents(event.sender)
      menu.popup({ window })
    }
  )

  /**
   * An event sent by the renderer asking for a copy of the current
   * application menu.
   */
  ipcMain.on('get-app-menu', () => {
    if (mainWindow) {
      mainWindow.sendAppMenu()
    }
  })

  ipcMain.on(
    'show-certificate-trust-dialog',
    (
      event: Electron.IpcMessageEvent,
      {
        certificate,
        message,
      }: { certificate: Electron.Certificate; message: string }
    ) => {
      // This API is only implemented for macOS and Windows right now.
      if (__DARWIN__ || __WIN32__) {
        onDidLoad(window => {
          window.showCertificateTrustDialog(certificate, message)
        })
      }
    }
  )

  ipcMain.on(
    'log',
    (event: Electron.IpcMessageEvent, level: LogLevel, message: string) => {
      writeLog(level, message)
    }
  )

  ipcMain.on(
    'uncaught-exception',
    (event: Electron.IpcMessageEvent, error: Error) => {
      handleUncaughtException(error)
    }
  )

  ipcMain.on(
    'send-error-report',
    (
      event: Electron.IpcMessageEvent,
      { error, extra }: { error: Error; extra: { [key: string]: string } }
    ) => {
      reportError(error, {
        ...getExtraErrorContext(),
        ...extra,
      })
    }
  )

  ipcMain.on(
    'open-external',
    (event: Electron.IpcMessageEvent, { path }: { path: string }) => {
      const pathLowerCase = path.toLowerCase()
      if (
        pathLowerCase.startsWith('http://') ||
        pathLowerCase.startsWith('https://')
      ) {
        log.info(`opening in browser: ${path}`)
      }

      const result = shell.openExternal(path)
      event.sender.send('open-external-result', { result })
    }
  )

  ipcMain.on(
    'show-item-in-folder',
    (event: Electron.IpcMessageEvent, { path }: { path: string }) => {
      Fs.stat(path, (err, stats) => {
        if (err) {
          log.error(`Unable to find file at '${path}'`, err)
          return
        }

        if (!__DARWIN__ && stats.isDirectory()) {
          openDirectorySafe(path)
        } else {
          shell.showItemInFolder(path)
        }
      })
    }
  )
})

app.on('activate', () => {
  onDidLoad(window => {
    window.show()
  })
})

app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, url) => {
    // Prevent links or window.open from opening new windows
    event.preventDefault()
    log.warn(`Prevented new window to: ${url}`)
  })
})

app.on(
  'certificate-error',
  (event, webContents, url, error, certificate, callback) => {
    callback(false)

    onDidLoad(window => {
      window.sendCertificateError(certificate, error, url)
    })
  }
)

function createWindow() {
  const window = new AppWindow()

  if (__DEV__) {
    const {
      default: installExtension,
      REACT_DEVELOPER_TOOLS,
      REACT_PERF,
    } = require('electron-devtools-installer')

    require('electron-debug')({ showDevTools: true })

    const ChromeLens = {
      id: 'idikgljglpfilbhaboonnpnnincjhjkd',
      electron: '>=1.2.1',
    }

    const extensions = [REACT_DEVELOPER_TOOLS, REACT_PERF, ChromeLens]

    for (const extension of extensions) {
      try {
        installExtension(extension)
      } catch (e) {}
    }
  }

  window.onClose(() => {
    mainWindow = null
    if (!__DARWIN__ && !preventQuit) {
      app.quit()
    }
  })

  window.onDidLoad(() => {
    window.show()
    window.sendLaunchTimingStats({
      mainReadyTime: readyTime!,
      loadTime: window.loadTime!,
      rendererReadyTime: window.rendererReadyTime!,
    })

    const fns = onDidLoadFns!
    onDidLoadFns = null
    for (const fn of fns) {
      fn(window)
    }
  })

  window.load()

  mainWindow = window
}

/**
 * Register a function to be called once the window has been loaded. If the
 * window has already been loaded, the function will be called immediately.
 */
function onDidLoad(fn: OnDidLoadFn) {
  if (onDidLoadFns) {
    onDidLoadFns.push(fn)
  } else {
    if (mainWindow) {
      fn(mainWindow)
    }
  }
}
