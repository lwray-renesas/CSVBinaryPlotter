const {app, BrowserWindow, ipcMain, dialog} = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');

const {SerialPort} = require('serialport');
const {Menu} = require('electron');
const {CsvBinaryParser} = require('./csvbin');
const {StateManager, defaultState} = require('./state');

let win;
let serialPort;
let tcpSocket;
let plotBuffer = [];
let currentLogFilePath = null;
let parserReady = false;

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

function pushPlotRow(values) {
  plotBuffer.push(values);

  while (plotBuffer.length > appState.get().maxSamples) {
    plotBuffer.shift();
  }
}

function handleParsedRow(values) {
  if (appState.get().isRunning && parserReady) {
    pushPlotRow(values);
    if (win && !win.isDestroyed() && currentLogFilePath) {
      fs.appendFile(currentLogFilePath, values.join(',') + '\n', (err) => {
        if (err) console.error(err);
      });
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
  parserReady = true;
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

  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
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

async function connectSerial(settings) {
  try {
    if (serialPort?.isOpen) {
      return {
        success: false,
        error: 'Port already open',
      };
    }

    serialPort = new SerialPort({
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
      serialPort.open((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    // dettach data listeners
    serialPort.removeAllListeners('data');

    // Start listening for data
    serialPort.on('data', (chunk) => {
      binaryParser.push(chunk);
    });

    // Update app state with port information
    appState.set({
      isConnected: true,
      lastError: null,
      connection: {
        ...appState.get().connection,
        type: 'serial',
        serialSettings: {
          portName: settings.portName,
          baudRate: Number(settings.baudRate),
          dataBits: Number(settings.dataBits),
          stopBits: Number(settings.stopBits),
          parity: settings.parity,
        },
      },
    });

    // If we receive an error, handle it.
    serialPort.on('error', (err) => {
      console.error('Serial error:', err.message);
      if (win && !win.isDestroyed()) {
        appState.set(
            {isConnected: false, isRunning: false, lastError: err.message});
      }
    });

    // If we disconnect, handle it.
    serialPort.on('close', (err) => {
      if (win && !win.isDestroyed()) {
        appState.set({isConnected: false, isRunning: false});
      }
    });

  } catch (err) {
    console.error(err);
    // Update app state
    appState.set({isConnected: false, lastError: err.message});
  }
}

async function connectTcp(settings) {
  try {
    tcpSocket = new net.Socket();

    await new Promise((resolve, reject) => {
      tcpSocket.connect(
          settings.port,
          settings.ip,
          resolve,
      );

      tcpSocket.once('error', reject);
    });

    tcpSocket.on('data', (chunk) => {
      binaryParser.push(chunk);
    });

    tcpSocket.on('close', () => {
      appState.set({
        isConnected: false,
        isRunning: false,
      });
    });

    tcpSocket.on('error', (err) => {
      appState.set({
        isConnected: false,
        isRunning: false,
        lastError: err.message,
      });
    });

    appState.set({
      isConnected: true,
      lastError: null,
      connection: {
        ...appState.get().connection,
        type: 'tcp',
        tcpSettings: {
          ip: settings.ip,
          port: settings.port,
        },
      },
    });

  } catch (err) {
    tcpSocket = null;
    appState.set({
      isConnected: false,
      lastError: err.message,
    });
  }
}

function writeTransport(data) {
  if (serialPort?.isOpen) {
    serialPort.write(data);
  }

  if (tcpSocket) {
    tcpSocket.write(data);
  }
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

ipcMain.handle('data-connect', async (_, settings) => {
  if (settings.connectionType === 'serial') {
    return await connectSerial(settings);
  }

  if (settings.connectionType === 'tcp') {
    return await connectTcp(settings);
  }

  throw new Error(`Unsupported connection type: ${settings.connectionType}`);
});

ipcMain.handle('data-disconnect', async () => {
  try {
    if (serialPort?.isOpen) {
      serialPort.removeAllListeners('data');
      serialPort.close();
      serialPort = null;
    }
    if (tcpSocket) {
      tcpSocket.removeAllListeners();
      tcpSocket.destroy();
      tcpSocket = null;
    }

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
  if (!serialPort && !tcpSocket) {
    return;
  }

  appState.set({isRunning: !(appState.get().isRunning)});
  const state = appState.get();

  if (state.isRunning) {
    parserReady = false;
    binaryParser.reset();

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
    writeTransport('M');

  } else {
    currentLogFilePath = null;
    binaryParser.reset();
  }
});

ipcMain.handle('config-update', async (_, config) => {
  try {
    if (config.connection) {
      const current = appState.get();
      appState.set({
        connection: {
          ...current.connection,
          ...config.connection,
        },
      });
    }

    // Update baud rate if possible
    if (serialPort && serialPort.isOpen && config.connection?.serialSettings) {
      await new Promise((resolve, reject) => {
        serialPort.update(
            {baudRate: Number(config.connection.serialSettings.baudRate)},
            (err) => {
              if (err)
                reject(err);
              else
                resolve();
            });
      });
    }

    // Update sample buffer
    if (config.maxSamples) {
      appState.set({
        maxSamples: config.maxSamples,
      });

      while (plotBuffer.length > config.maxSamples) {
        plotBuffer.shift();
      }
    }
  } catch (err) {
    console.error(err);
  }
});

ipcMain.handle('plot-data-get', async () => {
  return plotBuffer;
});

app.on('before-quit', () => {
  if (serialPort && serialPort.isOpen) {
    serialPort.close();
  }
  if (tcpSocket) {
    tcpSocket.destroy();
  }
});