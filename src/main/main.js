const {app, BrowserWindow, ipcMain, dialog} = require('electron');
const path = require('path');
const fs = require('fs');

const {SerialPort} = require('serialport');
const {Menu} = require('electron');
const {CsvBinaryParser} = require('./csvbin');
const {StateManager, defaultState} = require('./state');

let win;
let port;
let pendingRows = [];
let lastFlush = Date.now();
let currentLogFilePath = null;

let appState = new StateManager((newState) => {
  // On state change, send state update and new state object.
  if (win && !win.isDestroyed()) {
    win.webContents.send('state-update', newState);
  }
});
let binaryParser =
    new CsvBinaryParser({onRow: handleParsedRow, onMeta: handleMeta});

// Function generates a log file path from the current date time.
function generateLogFilePath(folder) {
  const now = new Date();

  const pad = (n) => n.toString().padStart(2, '0');

  const ts =
      `${pad(now.getDate())}_${pad(now.getMonth() + 1)}_${now.getFullYear()}_` +
      `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  return path.join(folder, `data_${ts}.csv`);
}


function handleParsedRow(values) {
  if (appState.get().isRunning) {
    const refreshRate = Math.round(1000 / appState.get().sampleRateHz)
    pendingRows.push(values);
    const now = Date.now();
    if ((now - lastFlush) > refreshRate) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('serial-data-ready', pendingRows);
        if (currentLogFilePath) {
          let lines = '';
          for (const row of pendingRows) {
            for (let i = 0; i < row.length; ++i) {
              lines += row[i];
              if (i < row.length - 1) {
                lines += ',';
              }
            }
            lines += '\n';
          }
          fs.appendFile(currentLogFilePath, lines, (err) => {
            if (err) console.error(err);
          });
        }
      }
      pendingRows.length = 0;
      lastFlush = now;
    }
  }
}

function handleMeta(meta) {
  const current = appState.get().parser;

  switch (meta.type) {
    case 'names':
      appState.set({parser: {...current, names: meta.data}});
      if (currentLogFilePath) {
        fs.appendFileSync(currentLogFilePath, meta.data.join(',') + '\n');
      }
      break;

    case 'types':
      appState.set({parser: {...current, types: meta.data}});
      if (currentLogFilePath) {
        fs.appendFileSync(currentLogFilePath, meta.data.join(',') + '\n');
      }
      break;

    case 'endian':
      appState.set({parser: {...current, endian: meta.data}});
      if (currentLogFilePath) {
        fs.appendFileSync(currentLogFilePath, meta.data + '\n');
      }
      break;
  }

  checkHandshakeComplete();
}

function checkHandshakeComplete() {
  const {names, types, endian} = appState.get().parser;

  const complete = names.length > 0 && types.length > 0 && !!endian;

  if (!complete) return;

  // Reset parser now that we know format
  binaryParser.reset();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,

    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, '../renderer/preload.js'),
      contextIsolation: true,
    },
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function createMenu() {
  // TODO: No need for release
  const template = [{
    label: 'Settings',
    submenu: [
      {role: 'toggleDevTools'},
    ]
  }];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.commandLine.appendSwitch('remote-debugging-port', '9222');

app.whenReady().then(async () => {
  createWindow();
  createMenu();
});

ipcMain.handle('state-get', () => {
  // Get the application state for the renderer to process
  return appState.get();
});

ipcMain.handle('select-save-folder', async () => {
  const result = await dialog.showOpenDialog(
      {title: 'Select Save Folder', properties: ['openDirectory']});

  // result.filePaths is an array
  const folderPath = result.canceled || result.filePaths.length === 0 ?
      null :
      result.filePaths[0];

  appState.set({saveFolderPath: folderPath});
});

ipcMain.handle('serial-list-ports', async () => {
  const result = await SerialPort.list();
  return result;
});

ipcMain.handle('serial-connect', async (_, settings) => {
  try {
    if (port?.isOpen) {
      return {
        success: false,
        error: 'Port already open',
      };
    }

    port = new SerialPort({
      path: settings.portName,
      baudRate: Number(settings.baudRate),
      dataBits: Number(settings.dataBits),
      stopBits: Number(settings.stopBits),
      parity: settings.parity,
      autoOpen: false,
    });

    // Waits for promise to resolve (i.e., port to open or fail to open)
    await new Promise((resolve, reject) => {
      // Calls open and provides callback to handle post call processing (open
      // vs error) if open failed, an error message is passed and we throw
      // this with "reject" if open successful, we resolve the promise and
      // return nothing and move on.
      port.open((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    // dettach data listeners
    port.removeAllListeners('data');

    // Start listening for data
    port.on('data', (chunk) => {
      binaryParser.push(chunk);
    });

    // Update app state with port information
    appState.set({isConnected: true, port: {...settings}, lastError: null});

    // If we receive an error, handle it.
    port.on('error', (err) => {
      console.error('Serial error:', err.message);
      if (win && !win.isDestroyed()) {
        appState.set(
            {isConnected: false, isRunning: false, lastError: err.message});
      }
    });

    // If we disconnect, handle it.
    port.on('close', (err) => {
      if (win && !win.isDestroyed()) {
        appState.set({isConnected: false, isRunning: false});
      }
    });

  } catch (err) {
    console.error(err);
    // Update app state
    appState.set({isConnected: false, lastError: err.message});
  }
});

ipcMain.handle('serial-disconnect', async () => {
  try {
    // try close the port.
    if (port?.isOpen) {
      // dettach data listeners
      port.removeAllListeners('data');
      port.close();
    }

    // Destroy the objects.
    port = null;

    // Update app state
    appState.set({isConnected: false, isRunning: false});

  } catch (err) {
    console.error(err);
    // Update app state
    appState.set(
        {isConnected: false, isRunning: false, lastError: err.message});
  }
});

ipcMain.handle('run-toggle-notify', async () => {
  if (!port) return;

  appState.set({isRunning: !(appState.get().isRunning)});
  const state = appState.get();

  if (state.isRunning) {
    binaryParser.reset();
    pendingRows.length = 0;
    lastFlush = Date.now();

    // Reset parser state in appState
    appState.set(
        {parser: {names: [], types: [], endian: null}},
    );

    // Make a savefile if applicable
    if (state.saveFolderPath) {
      currentLogFilePath = generateLogFilePath(state.saveFolderPath);
      // create file (overwrite if exists)
      fs.writeFileSync(currentLogFilePath, '');
    } else {
      currentLogFilePath = null;
    }

    // Request metadata
    port.write('M');

  } else {
    currentLogFilePath = null;
    binaryParser.reset();
  }
});

ipcMain.handle('config-update', async (_, config) => {
  try {
    // Update baud rate if possible
    if (port && port.isOpen) {
      await new Promise((resolve, reject) => {
        port.update({baudRate: Number(config.portSettings.baudRate)}, (err) => {
          if (err)
            reject(err);
          else
            resolve();
        });
      });
    }

    // Update parser settings if possible
    if (binaryParser) {
      binaryParser.setFormat(config.dataFormat, config.dataEndian);
    }
  } catch (err) {
    console.error(err);
  }
});

app.on('before-quit', () => {
  if (port && port.isOpen) {
    port.close();
  }
});