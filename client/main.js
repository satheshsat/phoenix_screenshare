const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const { mouse, keyboard, Point, Button, Key } = require('@nut-tree-fork/nut-js');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handler to get screen sources
ipcMain.handle('get-screen-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] });
  return sources.map(source => ({
    id: source.id,
    name: source.name
  }));
});

// IPC Handler for remote control events
ipcMain.on('remote-control', async (event, data) => {
  try {
    const { type, x, y, button, key } = data;
    switch (type) {
      case 'mousemove':
        // Move mouse without smoothing for instant reaction
        mouse.config.mouseSpeed = 10000;
        await mouse.setPosition(new Point(x, y));
        break;
      case 'mousedown':
        if (button === 0) await mouse.pressButton(Button.LEFT);
        if (button === 2) await mouse.pressButton(Button.RIGHT);
        break;
      case 'mouseup':
        if (button === 0) await mouse.releaseButton(Button.LEFT);
        if (button === 2) await mouse.releaseButton(Button.RIGHT);
        break;
      case 'keydown':
        const nutKeyDown = getNutKey(key);
        if (nutKeyDown) await keyboard.pressKey(nutKeyDown);
        break;
      case 'keyup':
        const nutKeyUp = getNutKey(key);
        if (nutKeyUp) await keyboard.releaseKey(nutKeyUp);
        break;
    }
  } catch (error) {
    console.error('Error executing remote control:', error);
  }
});

function getNutKey(keyString) {
  const keyMap = {
    'Enter': Key.Enter,
    'Backspace': Key.Backspace,
    'Escape': Key.Escape,
    'Tab': Key.Tab,
    ' ': Key.Space,
    'Shift': Key.LeftShift,
    'Control': Key.LeftControl,
    'Alt': Key.LeftAlt,
    'Meta': Key.LeftSuper,
  };
  
  if (keyMap[keyString]) return keyMap[keyString];
  
  if (keyString.length === 1) {
    // Basic mapping for alphanumeric keys
    try {
      const upper = keyString.toUpperCase();
      if (Key[upper]) return Key[upper];
    } catch(e) {}
  }
  return null;
}
