export const shell = {
  moveItemToTrash: jest.fn(),
}

export const remote = {
  getCurrentWindow: jest.fn().mockImplementation(() => ({
    webContents: {
      getZoomFactor: jest.fn().mockImplementation(_ => null),
    },
  })),
  autoUpdater: {
    on: jest.fn(),
  },
}

export const ipcRenderer = {
  on: jest.fn(),
  send: jest.fn(),
}
