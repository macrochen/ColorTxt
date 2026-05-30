import { BrowserWindow, ipcMain } from "electron";

const allowNextClose = new WeakSet<BrowserWindow>();

let ipcRegistered = false;

export function registerWindowCloseGuardIpc() {
  if (ipcRegistered) return;
  ipcRegistered = true;
  ipcMain.on("window:proceedClose", (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win || win.isDestroyed()) return;
    allowNextClose.add(win);
    win.close();
  });
}

/**
 * 首次用户关窗时由渲染进程决定是否 `preventDefault`；确认后通过 `window:proceedClose` 再次 `close()`。
 * 须在 `registerWindowCloseGuardIpc()` 之后、窗口创建时调用。
 */
export function attachWindowCloseRequestGuard(win: BrowserWindow) {
  win.on("close", (e) => {
    if (allowNextClose.has(win)) {
      allowNextClose.delete(win);
      return;
    }
    e.preventDefault();
    if (!win.webContents.isDestroyed()) {
      try {
        win.webContents.send("window:requestClose");
      } catch (e) {
        // Ignore errors if the webContents is already destroyed
      }
    }
  });
}
