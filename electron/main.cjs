/**
 * Orqiva desktop shell. Starts the bundled Express server inside Electron on this
 * machine and opens it in a window. Data lives in the user's profile folder, so
 * updating or reinstalling the app never touches it.
 */
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const appDir = __dirname;
// Filled in by scripts/stage-installer.mjs. Release builds pin the server bundle hash.
const RELEASE = __ORQIVA_RELEASE__;
const SERVER_SHA256 = '__ORQIVA_SERVER_SHA256__';
let mainWindow = null;

function freePort(preferred) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => {
      const any = net.createServer();
      any.listen(0, '0.0.0.0', () => {
        const { port } = any.address();
        any.close(() => resolve(port));
      });
    });
    probe.listen(preferred, '0.0.0.0', () => probe.close(() => resolve(preferred)));
  });
}

async function waitForServer(port) {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('السيرفر الداخلي لم يبدأ في الوقت المتوقع');
}

async function startServer() {
  const userData = app.getPath('userData');
  const dataDir = path.join(userData, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'orqiva.db');
  const firstRun = !fs.existsSync(dbPath);

  const port = await freePort(Number(process.env.ORQIVA_PORT) || 3001);
  Object.assign(process.env, {
    NODE_ENV: 'production',
    PORT: String(port),
    DATABASE_PATH: dbPath,
    ORQIVA_BACKUP_DIR: path.join(userData, 'backups'),
    SEED_DEMO: 'false',
    COOKIE_SECURE: 'false',
  });
  // Release builds carry their public key inside the server bundle and ignore this variable.
  // The open test build is the only one that honors it.

  if (firstRun) {
    // First launch: create the administrator with a random password and tell the owner where it is.
    const password = crypto.randomBytes(9).toString('base64url');
    process.env.SEED_PASSWORD = password;
    const note = path.join(userData, 'بيانات-الدخول-الأولى.txt');
    fs.writeFileSync(
      note,
      `البريد: admin@orqiva.com\nكلمة المرور: ${password}\n\nغيّر كلمة المرور بعد أول دخول ثم احذف هذا الملف.\n`,
    );
    app.once('browser-window-created', () => {
      dialog.showMessageBox({
        type: 'info',
        title: 'أوركيفا - أول تشغيل',
        message: 'تم إنشاء حساب المدير',
        detail: `البريد: admin@orqiva.com\nكلمة المرور: ${password}\n\nمحفوظة أيضًا في الملف:\n${note}\nغيّرها بعد أول دخول ثم احذف الملف.`,
      });
    });
  }

  const serverFile = path.join(appDir, 'server', 'server.mjs');
  if (RELEASE) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(serverFile)).digest('hex');
    if (actual !== SERVER_SHA256) {
      throw new Error('ملفات البرنامج تم تعديلها. أعد تثبيت أوركيفا من المثبّت الأصلي.');
    }
  }
  // The server serves ./dist relative to the working directory. Inside app.asar that folder is
  // unpacked next to the archive, because a process cannot change directory into an archive.
  process.chdir(appDir.replace(/app\.asar$/, 'app.asar.unpacked'));
  await import(pathToFileURL(serverFile).href);
  await waitForServer(port);
  return port;
}

async function createWindow() {
  let port;
  try {
    port = await startServer();
  } catch (error) {
    dialog.showErrorBox('تعذر تشغيل أوركيفا', String((error && error.message) || error));
    app.quit();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 860,
    title: 'Orqiva - أوركيفا',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !RELEASE,
    },
  });
  if (RELEASE) mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.loadURL(`http://127.0.0.1:${port}`);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
if (RELEASE) Menu.setApplicationMenu(null);
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
