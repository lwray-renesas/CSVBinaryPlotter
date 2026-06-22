let isRunning = false;
let isConnected = false;
let maxSamples = 200;
let currentSample = 0;
let graphInterval = null;
let currentIntervalMs = 50;
let lastParserSignature = '';
let autoYAxisEnabled = true;
let manualYMin = 0;
let manualYMax = 100;


const datasets = [];
const dataBuffers = [];

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
    interaction: {
      intersect: false,
      mode: 'index',
    },
    plugins: {
      legend: {
        labels: {
          color: '#e5e7eb',
        },
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

// Trys connect to (or disconnect from) serial port.
async function SerialTryConnect() {
  document.getElementById('serialConnectButton').disabled = true;
  if (isConnected) {
    document.getElementById('serialConnectButton').innerText =
        'Disconnecting...';
    await window.api.SerialDisconnect();
  } else {
    const settings = {
      portName: document.getElementById('port').value,
      baudRate: document.getElementById('baudRate').value,
      dataBits: document.getElementById('dataBits').value,
      stopBits: document.getElementById('stopBits').value,
      parity: document.getElementById('parity').value
    };
    document.getElementById('serialConnectButton').innerText = 'Connecting...';

    await window.api.SerialConnect(settings);
  }
  document.getElementById('serialConnectButton').disabled = false;
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
  maxSamples = parseInt(document.getElementById('windowSize').value, 10);
  if (Number.isNaN(maxSamples) || maxSamples < 1) {
    return;
  }
  currentSample = 0;

  // Rebuild buffers
  dataBuffers.forEach((buffer, i) => {
    const newBuffer = new Array(maxSamples).fill(null);

    // Copy existing data (right-aligned)
    const copyLength = Math.min(buffer.length, maxSamples);
    for (let j = 0; j < copyLength; j++) {
      newBuffer[maxSamples - copyLength + j] =
          buffer[buffer.length - copyLength + j];
    }

    dataBuffers[i] = newBuffer;
    datasets[i].data = newBuffer;
  });
  chart.data.labels = [...Array(maxSamples).keys()];
  chart.update('none');

  // Inform main process of config update
  const settings = {
    portName: document.getElementById('port').value,
    baudRate: document.getElementById('baudRate').value,
    dataBits: document.getElementById('dataBits').value,
    stopBits: document.getElementById('stopBits').value,
    parity: document.getElementById('parity').value,
  };

  const config = {
    portSettings: settings,
  };

  await window.api.ConfigUpdate(config);
}

// Rebuild buffers from parser informations
function rebuildFromParser(parser) {
  if (!parser.names?.length || !parser.types?.length) return;

  datasets.length = 0;
  dataBuffers.length = 0;

  parser.names.forEach((name, i) => {
    const buffer = new Array(maxSamples).fill(null);

    dataBuffers.push(buffer);

    datasets.push({
      label: name,
      data: buffer,
      borderWidth: 2,
      borderColor: getColour(i),
      tension: 0.25,
      pointRadius: 0,
      spanGap: false,
    });
  });

  currentSample = 0;

  chart.data.datasets = datasets;
  chart.data.labels = [...Array(maxSamples).keys()];

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

  // ===== AUTO MODE (unchanged) =====
  let min = Infinity;
  let max = -Infinity;

  chart.data.datasets.forEach((dataset, i) => {
    // Skip hidden datasets
    if (!chart.isDatasetVisible(i)) {
      return;
    };

    const buffer = dataBuffers[i];
    if (!buffer) {
      return;
    };

    for (const value of buffer) {
      if (value < min) min = value;
      if (value > max) max = value;
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

function processSerialData(batch) {
  if (!isRunning) return;

  for (const values of batch) {
    if (values.some(isNaN)) continue;

    values.forEach((v, i) => {
      if (!dataBuffers[i]) return;  // safety

      if (currentSample < maxSamples) {
        dataBuffers[i][currentSample] = v;
      } else {
        dataBuffers[i].shift();
        dataBuffers[i].push(v);
      }
    });

    if (currentSample < maxSamples) {
      ++currentSample;
    }
  }

  updateYAxis();
  chart.update('none');
}

function StateUpdated(newState) {
  const ids = [
    'port', 'baudRate', 'dataBits', 'parity', 'stopBits', 'serialRefreshButton'
  ];
  const sidebar = document.querySelector('.sidebar');

  // Detect disconnection
  if (isConnected && !newState.isConnected) {
    // Update serial port list
    SerialTryListPorts();
  }

  // Detect transition to running state
  if (!isRunning && newState.isRunning) {
    // Reset buffers if we have started running successfully
    currentSample = 0;
    dataBuffers.forEach((buffer, i) => {
      const newBuffer = new Array(maxSamples).fill(null);
      dataBuffers[i] = newBuffer;
      datasets[i].data = newBuffer;
    });
    chart.data.labels = [...Array(maxSamples).keys()];
    chart.update('none');
  }

  // Update current states
  isConnected = newState.isConnected;
  isRunning = newState.isRunning;

  // Connected checks
  if (isConnected) {
    document.getElementById('serialConnectButton').innerText = 'Disconnect';
    document.getElementById('serialConnectButton')
        .classList.remove('primary-btn');
    document.getElementById('serialConnectButton').classList.add('danger');
    document.getElementById('connectionStatusText').innerText = 'Connected';
    document.getElementById('connectionStatusDot').classList.add('on');
    document.getElementById('runToggleButton').disabled = false;
    document.getElementById('port').value = newState.port.portName;
    document.getElementById('baudRate').value = newState.port.baudRate;
    document.getElementById('dataBits').value = newState.port.dataBits;
    document.getElementById('stopBits').value = newState.port.stopBits;
    document.getElementById('parity').value = newState.port.parity;
  } else {
    document.getElementById('serialConnectButton').innerText = 'Connect';
    document.getElementById('serialConnectButton').classList.remove('danger');
    document.getElementById('serialConnectButton').classList.add('primary-btn');
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

  console.log(signature);

  if (signature !== lastParserSignature) {
    lastParserSignature = signature;
    rebuildFromParser(parser);
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  // Immediately get the state of the application to process
  const state = await window.api.GetAppState();
  StateUpdated(state);

  // Force port list refresh if we're not connected
  if (!isConnected) {
    SerialTryListPorts();
  }

  // Register callback for anytime the application state is updated.
  window.api.On_StateUpdate((newState) => {
    StateUpdated(newState);
  });

  // Add events listeners to UI
  document.getElementById('serialConnectButton').onclick = SerialTryConnect;
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

  // Handle Serial Data
  window.api.On_SerialDataReady((batch) => {
    processSerialData(batch);
  });
});

window.onload = () => {
  // Nothing to do here
};