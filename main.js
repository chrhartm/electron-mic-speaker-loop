const { app, BrowserWindow, desktopCapturer, ipcMain, session, systemPreferences } = require('electron');
const path = require('node:path');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 650,
    height: 600,
    title: '10s Mic + Speaker Looper',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  ipcMain.handle('debug-log', (_event, message, meta) => {
    if (meta !== undefined) {
      console.log(`[renderer] ${message}`, meta);
    } else {
      console.log(`[renderer] ${message}`);
    }
  });

  ipcMain.handle('permissions-status', () => {
    const statuses = {
      isPackaged: app.isPackaged,
      appName: app.getName()
    };
    for (const mediaType of ['microphone', 'screen']) {
      try {
        statuses[mediaType] = systemPreferences.getMediaAccessStatus(mediaType);
      } catch (error) {
        statuses[mediaType] = `error: ${error.message}`;
      }
    }
    console.log('[main] Permission status check:', statuses);
    return statuses;
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    console.log('[main] Display media request received.', {
      webContentsId: request.frame?.webContents?.id
    });
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      console.log('[main] Available screen sources:', sources.map((source) => source.name));
      callback({
        video: sources[0],
        audio: 'loopback'
      });
      console.log('[main] Responded with audio=loopback and first screen source.');
    } catch (error) {
      console.error('Failed to set display media source:', error);
      callback({
        video: null,
        audio: null
      });
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
