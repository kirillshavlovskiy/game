/**
 * Desktop wrapper for the Next.js static export in `out/`.
 *
 * Loads `out/index.html` directly via `file://`. The Next build already uses
 * `assetPrefix: "./"` + `trailingSlash: true` (see `next.config.js` ITCH_EXPORT
 * branch), so every chunk / GLB / texture path resolves under the same
 * `file://…/out/` origin — the same path the itch.io HTML5 build uses.
 *
 * Kept dependency-free so the asar stays tiny; the heavy `out/` tree is
 * unpacked via `asarUnpack` in electron-builder.yml so Chromium can stream
 * GLBs directly from disk.
 */
const { app, BrowserWindow, Menu, shell } = require("electron");
const path = require("path");

const INDEX_HTML = path.join(__dirname, "..", "out", "index.html");
const ICON_PATH = path.join(__dirname, "..", "build", "icon.png");

/** Reuse the same window instance if the user re-activates (macOS dock click). */
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#0b0b12",
    title: "Dice Of The Damned",
    icon: ICON_PATH,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.loadFile(INDEX_HTML);

  /** External links (devlog, credits) open in the OS browser, not a new Electron window. */
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  /** Hide the default Electron menu — the game has its own in-UI menu. */
  Menu.setApplicationMenu(null);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  /** Standard non-mac quit behavior — mac keeps the app alive in the dock. */
  if (process.platform !== "darwin") app.quit();
});
