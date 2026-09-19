
import {ChartManager} from './util/chartManager.js';
import {SignalListView} from './util/signalListView.js';
import {SignalManager} from './util/signalManager.js';

let isRunning = false;
let isConnected = false;
let lastParserSignature = '';
let plotRequestInFlight = false;
let resizingSidebar = false;

const signalManager = new SignalManager();
let chartManager = null;
let signalListView = null;

// Helper to update plot datasets
function updatePlot(rows) {
  if (!rows.length) {
    return;
  }

  signalManager.signals.forEach((signal) => {
    const channel = signal.channelIndex;
    signal.buffer.length = 0;
    for (let i = 0; i < rows.length; i++) {
      signal.buffer.push(rows[i][channel]);
    }
  });

  chartManager.synchronise();
  updateAxisControlsVisibility();
}

// Plots data to the graph
async function plotLoop() {
  if (isRunning && !plotRequestInFlight) {
    plotRequestInFlight = true;

    try {
      const rows = await window.api.GetPlotData();

      updatePlot(rows);

    } finally {
      plotRequestInFlight = false;
    }
  }

  requestAnimationFrame(plotLoop);
}

// Gets the serial ports currently enumerated
async function SerialTryListPorts() {
  const ports = await window.api.SerialListPorts();
  const dropdown = document.getElementById('port');
  dropdown.innerHTML = '';

  ports.forEach((p) => {
    const option = document.createElement('option');
    option.value = p.path;
    option.text = `${p.path} ` +
        `(${p.manufacturer || 'Unknown'})`;
    dropdown.appendChild(option);
  });
}

// Trys connect to (or disconnect from) data link.
async function DataTryConnect() {
  const type = document.getElementById('connectionType').value;
  document.getElementById('connectButton').disabled = true;

  try {
    if (isConnected) {
      document.getElementById('connectButton').innerText = 'Disconnecting...';
      await window.api.DataDisconnect();
    } else {
      let settings;
      if (type === 'serial') {
        settings = {
          connectionType: 'serial',
          portName: document.getElementById('port').value,
          baudRate: document.getElementById('baudRate').value,
          dataBits: document.getElementById('dataBits').value,
          stopBits: document.getElementById('stopBits').value,
          parity: document.getElementById('parity').value
        };
      } else {
        settings = {
          connectionType: 'tcp',
          ip: document.getElementById('tcpIp').value,
          port: Number(document.getElementById('tcpPort').value)
        };
      }
      document.getElementById('connectButton').innerText = 'Connecting...';
      await window.api.DataConnect(settings);
    }

  } finally {
    document.getElementById('connectButton').disabled = false;
  }
}

// Function to wait for a save folder to be selected
async function SaveFolderTryBrowse() {
  const sidebar = document.querySelector('.sidebar');

  // Disable UI
  sidebar.classList.add('disabled');
  if (isConnected) {
    document.getElementById('runToggleButton').disabled = true;
  }

  // Wait for save folder to be chosen by backend
  await window.api.SelectSaveFolder();

  // Enable UI
  sidebar.classList.remove('disabled');
  if (isConnected) {
    document.getElementById('runToggleButton').disabled = false;
  }
}

// Change configurations that main needs to be aware of
async function applyConfig() {
  if (chartManager) {
    chartManager.maxSamples = parseInt(
        document.getElementById('windowSize').value,
        10,
    );
  }
  const config = {
    maxSamples: parseInt(
        document.getElementById('windowSize').value,
        10,
        ),

    connection: {
      type: document.getElementById('connectionType').value,

      serialSettings: {
        portName: document.getElementById('port').value,
        baudRate: Number(document.getElementById('baudRate').value),
        dataBits: Number(document.getElementById('dataBits').value),
        stopBits: Number(document.getElementById('stopBits').value),
        parity: document.getElementById('parity').value,
      },

      tcpSettings: {
        ip: document.getElementById('tcpIp').value,
        port: Number(document.getElementById('tcpPort').value),
      },
    },
  };

  await window.api.ConfigUpdate(config);
}

// Helper to update axis options
function updateAxisControlsVisibility() {
  document.getElementById('yControls')
      .classList.toggle(
          'hidden',
          !chartManager.isYAxisUsed(),
      );

  document.getElementById('y1Controls')
      .classList.toggle(
          'hidden',
          !chartManager.isY1AxisUsed(),
      );
}

// Rebuild buffers from parser informations
function rebuildFromParser(parser) {
  if (!parser.names?.length || !parser.types?.length) {
    return;
  }

  signalManager.signals.length = 0;
  signalManager.datasets.length = 0;
  signalManager.order.length = 0;

  parser.names.forEach((name, i) => {
    signalManager.addSignal(
        name,
        [],
        getColour(i),
    );

    signalManager.getSignal(i).channelIndex = i;
  });

  signalListView.rebuild();
  chartManager.synchronise();
}

// Helper function to generate a new colour
function getColour(index) {
  const goldenRatio = 137.508;  // spreads colours nicely
  const hue = (index * goldenRatio) % 360;

  return `hsl(${hue}, 70%, 55%)`;
}

function StateUpdated(newState) {
  const ids = [
    'port', 'baudRate', 'dataBits', 'parity', 'stopBits', 'serialRefreshButton',
    'connectionType'
  ];
  const sidebar = document.querySelector('.sidebar');

  // Detect disconnection
  if (isConnected && !newState.isConnected &&
      'serial' === newState.connection.type) {
    // Update serial port list
    SerialTryListPorts();
  }

  // Update current states
  isConnected = newState.isConnected;
  isRunning = newState.isRunning;

  // Connected checks
  if (isConnected) {
    document.getElementById('connectButton').innerText = 'Disconnect';
    document.getElementById('connectButton').classList.remove('primary-btn');
    document.getElementById('connectButton').classList.add('danger');
    document.getElementById('connectionStatusText').innerText = 'Connected';
    document.getElementById('connectionStatusDot').classList.add('on');
    document.getElementById('runToggleButton').disabled = false;
    const serialSettings = newState.connection.serialSettings;
    const tcpSettings = newState.connection.tcpSettings;
    document.getElementById('port').value = serialSettings.portName ?? '';
    document.getElementById('baudRate').value = serialSettings.baudRate;
    document.getElementById('dataBits').value = serialSettings.dataBits;
    document.getElementById('stopBits').value = serialSettings.stopBits;
    document.getElementById('parity').value = serialSettings.parity;
    document.getElementById('connectionType').value = newState.connection.type;
    document.getElementById('tcpIp').value = tcpSettings.ip;
    document.getElementById('tcpPort').value = tcpSettings.port;
    document.getElementById('connectionType').value = newState.connection.type;
    if (newState.connection.type === 'serial') {
      document.getElementById('serialControls').classList.remove('hidden');
      document.getElementById('tcpControls').classList.add('hidden');
    } else {
      document.getElementById('serialControls').classList.add('hidden');
      document.getElementById('tcpControls').classList.remove('hidden');
    }
  } else {
    document.getElementById('connectButton').innerText = 'Connect';
    document.getElementById('connectButton').classList.remove('danger');
    document.getElementById('connectButton').classList.add('primary-btn');
    document.getElementById('connectionStatusText').innerText = 'Disconnected';
    document.getElementById('connectionStatusDot').classList.remove('on');
    document.getElementById('runToggleButton').disabled = true;
  }
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = isConnected;
    }
  });

  // Running checks
  if (isRunning) {
    document.getElementById('runToggleButton').innerText = 'Stop';
    document.getElementById('runToggleButton').classList.remove('success');
    document.getElementById('runToggleButton').classList.add('danger');
    document.getElementById('runningStatusText').innerText = 'Running';
    document.getElementById('runningStatusDot').classList.add('on');
  } else {
    document.getElementById('runToggleButton').innerText = 'Run';
    document.getElementById('runToggleButton').classList.remove('danger');
    document.getElementById('runToggleButton').classList.add('success');
    document.getElementById('runningStatusText').innerText = 'Stopped';
    document.getElementById('runningStatusDot').classList.remove('on');
  }

  // Update savefolder path
  if (newState.saveFolderPath) {
    document.getElementById('saveFolderPath').value = newState.saveFolderPath;
  } else {
    document.getElementById('saveFolderPath').value = '';
  }

  // Update buffers
  const parser = newState.parser;
  // Create a simple “signature” to detect change
  const signature = JSON.stringify(parser);

  if (signature !== lastParserSignature) {
    lastParserSignature = signature;
    rebuildFromParser(parser);
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  chartManager = new ChartManager(
      document.getElementById('chart'),
      signalManager,
  );

  signalListView = new SignalListView(
      document.getElementById('signalList'),
      signalManager,
      chartManager,
  );

  Sortable.create(
      document.getElementById('signalList'),
      {
        animation: 150,
        handle: '.signal-handle',
        ghostClass: 'signal-drag-ghost',
        chosenClass: 'signal-drag-chosen',
        dragClass: 'signal-dragging',

        onEnd: (evt) => {
          if (evt.oldIndex === evt.newIndex) {
            return;
          }

          signalManager.moveSignal(
              evt.oldIndex,
              evt.newIndex,
          );

          chartManager.synchronise();
          signalListView.rebuild();
        },
      },
  );

  // Immediately get the state of the application to process
  const state = await window.api.GetAppState();
  StateUpdated(state);

  // Update window size
  const windowSizeElement = document.getElementById('windowSize');
  const currentValue = parseInt(windowSizeElement.value, 10);
  if (currentValue !== state.maxSamples) {
    windowSizeElement.value = state.maxSamples;
  }

  // Handle resizing
  const sidebar = document.getElementById('sidebar');
  const resizeHandle = document.getElementById('sidebarResizeHandle');

  resizeHandle.addEventListener('mousedown', () => {
    resizingSidebar = true;
    document.body.classList.add('resizing');
  });

  window.addEventListener('mousemove', (e) => {
    if (!resizingSidebar) {
      return;
    }
    if ((e.buttons & 1) === 0) {
      resizingSidebar = false;
      document.body.classList.remove('resizing');
      return;
    }

    const left = sidebar.parentElement.getBoundingClientRect().left;
    const width = Math.max(
        220,
        Math.min(600, e.clientX - left),
    );

    sidebar.style.width = `${width}px`;
    sidebar.style.flexBasis = `${width}px`;
    chartManager.chart.resize();
  });

  window.addEventListener('mouseup', () => {
    resizingSidebar = false;
    document.body.classList.remove('resizing');
  });

  if (chartManager) {
    chartManager.maxSamples = parseInt(
        document.getElementById('windowSize').value,
        10,
    );
  }

  // Force port list refresh if we're not connected
  if (!isConnected) {
    SerialTryListPorts();
  }

  // Register callback for anytime the application state is updated.
  window.api.On_StateUpdate((newState) => {
    StateUpdated(newState);
  });


  // Add events listeners to UI
  document.getElementById('connectionType').addEventListener('change', () => {
    if (document.getElementById('connectionType').value === 'serial') {
      document.getElementById('serialControls').classList.remove('hidden');
      document.getElementById('tcpControls').classList.add('hidden');
    } else {
      document.getElementById('serialControls').classList.add('hidden');
      document.getElementById('tcpControls').classList.remove('hidden');
    }
    applyConfig();
  });
  document.getElementById('connectButton').onclick = DataTryConnect;
  document.getElementById('serialRefreshButton').onclick = SerialTryListPorts;
  document.getElementById('runToggleButton').onclick = () => {
    window.api.RunToggleNotify()
  };
  document.getElementById('browseSaveFolder').onclick = SaveFolderTryBrowse;
  document.getElementById('windowSize').onchange = applyConfig;
  document.getElementById('baudRate').onchange = applyConfig;
  document.getElementById('dataBits').onchange = applyConfig;
  document.getElementById('parity').onchange = applyConfig;
  document.getElementById('stopBits').onchange = applyConfig;
  document.getElementById('tcpIp').onchange = applyConfig;
  document.getElementById('tcpPort').onchange = applyConfig;
  document.getElementById('saveFolderPath').onchange = applyConfig;
  document.getElementById('yAuto').addEventListener('change', (e) => {
    chartManager.yAuto = e.target.checked;
    document.getElementById('yMin').disabled = e.target.checked;
    document.getElementById('yMax').disabled = e.target.checked;
    chartManager.synchronise();
  });
  document.getElementById('yMin').onchange = (e) => {
    chartManager.yMin = Number(e.target.value);
    chartManager.synchronise();
  };
  document.getElementById('yMax').onchange = (e) => {
    chartManager.yMax = Number(e.target.value);
    chartManager.synchronise();
  };

  document.getElementById('y1Auto').addEventListener('change', (e) => {
    chartManager.y1Auto = e.target.checked;
    document.getElementById('y1Min').disabled = e.target.checked;
    document.getElementById('y1Max').disabled = e.target.checked;
    chartManager.synchronise();
  });
  document.getElementById('y1Min').onchange = (e) => {
    console.log(Number(e.target.value));
    chartManager.y1Min = Number(e.target.value);
    chartManager.synchronise();
  };
  document.getElementById('y1Max').onchange = (e) => {
    chartManager.y1Max = Number(e.target.value);
    chartManager.synchronise();
  };

  // Start plotting loop
  requestAnimationFrame(plotLoop);
});

window.onload = () => {
  // Nothing to do here
};