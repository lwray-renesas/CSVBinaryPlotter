let isRunning = false;
let isConnected = false;
let lastParserSignature = '';
let autoYAxisEnabled = true;
let manualYMin = 0;
let manualYMax = 100;
let plotRequestInFlight = false;

const datasets = [];

const ctx = document.getElementById('chart').getContext('2d');

const chart = new Chart(ctx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    parsing: false,
    interaction: {
      intersect: false,
      mode: 'index',
      mode: 'nearest',
    },
    plugins: {
      legend: {
        position: 'right',
        maxWidth: 250,
        labels: {
          color: '#e5e7eb',
          boxWidth: 12,
          padding: 8,
        },
      },
      decimation: {
        enabled: true,
        algorithm: 'min-max',
      },
    },
    scales: {
      x: {
        grid: {
          color: 'rgba(255,255,255,0.05)',
        },
        ticks: {
          color: '#94a3b8',
        },
        type: 'linear',
      },
      y: {
        grid: {
          color: 'rgba(255,255,255,0.05)',
        },
        ticks: {
          color: '#94a3b8',
        },
      },
    },
  },
});

// Helper to update plot datasets
function updatePlot(rows) {
  if (!rows.length) {
    return;
  }
  const channels = rows[0].length;
  for (let c = 0; c < channels; c++) {
    const dataset = datasets[c];
    if (!dataset) {
      continue;
    }
    dataset.data.length = 0;
    for (let i = 0; i < rows.length; i++) {
      dataset.data.push({x: i, y: rows[i][c]});
    }
  }

  updateYAxis();
  chart.update('none');
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

// Rebuild buffers from parser informations
function rebuildFromParser(parser) {
  if (!parser.names?.length || !parser.types?.length) return;

  datasets.length = 0;

  parser.names.forEach((name, i) => {
    datasets.push({
      label: name,
      data: [],
      borderWidth: 2,
      borderColor: getColour(i),
      tension: 0.25,
      pointRadius: 0,
      spanGap: false,
    });
  });

  chart.data.datasets = datasets;
  chart.update('none');
}

// Helper function to generate a new colour
function getColour(index) {
  const goldenRatio = 137.508;  // spreads colours nicely
  const hue = (index * goldenRatio) % 360;

  return `hsl(${hue}, 70%, 55%)`;
}

// Helper function to modify the axis controls between disabled/enabled when
// going between auto and manual
function updateYAxisControls() {
  document.getElementById('yMin').disabled = autoYAxisEnabled;
  document.getElementById('yMax').disabled = autoYAxisEnabled;
}

// Helper function to update the y axis on the chart to scale to min/max data in
// window
function updateYAxis() {
  if (!autoYAxisEnabled) {
    chart.options.scales.y.min = manualYMin;
    chart.options.scales.y.max = manualYMax;
    return;
  }

  let min = Infinity;
  let max = -Infinity;

  chart.data.datasets.forEach((dataset, i) => {
    // Skip hidden datasets
    if (!chart.isDatasetVisible(i)) {
      return;
    };

    const buffer = dataset.data;
    if (!buffer) {
      return;
    };

    for (const value of buffer) {
      const y = value.y;
      if (y < min) min = y;
      if (y > max) max = y;
    }
  });

  if (min !== Infinity && max !== -Infinity) {
    // avoid flat line collapse
    if (min === max) {
      min -= 1;
      max += 1;
    }

    chart.options.scales.y.min = min;
    chart.options.scales.y.max = max;
  }
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
  if (sidebar) {
    sidebar.classList.toggle('disabled', isRunning);
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
  // Immediately get the state of the application to process
  const state = await window.api.GetAppState();
  StateUpdated(state);

  // Update window size
  const windowSizeElement = document.getElementById('windowSize');
  const currentValue = parseInt(windowSizeElement.value, 10);
  if (currentValue !== state.maxSamples) {
    windowSizeElement.value = state.maxSamples;
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
  document.getElementById('yAxisToggle').addEventListener('change', (e) => {
    autoYAxisEnabled = e.target.checked;

    // Freeze current axis values when turning OFF (going manual)
    if (!autoYAxisEnabled) {
      manualYMin = chart.options.scales.y.min ?? manualYMin;
      manualYMax = chart.options.scales.y.max ?? manualYMax;

      document.getElementById('yMin').value = manualYMin;
      document.getElementById('yMax').value = manualYMax;
    }

    updateYAxisControls();
    updateYAxis();
    chart.update('none');
  });
  document.getElementById('yMin').onchange = (e) => {
    manualYMin = Number(e.target.value);
  };
  document.getElementById('yMax').onchange = (e) => {
    manualYMax = Number(e.target.value);
  };

  // Initialse the axis scaling controls
  autoYAxisEnabled = document.getElementById('yAxisToggle').checked;
  manualYMin = Number(document.getElementById('yMin').value);
  manualYMax = Number(document.getElementById('yMax').value);
  updateYAxisControls();

  // Start plotting loop
  requestAnimationFrame(plotLoop);
});

window.onload = () => {
  // Nothing to do here
};