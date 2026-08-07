
/** @type {AppState} */
const defaultState = {
  isConnected: false,
  isRunning: false,

  port: {
    portName: null,
    baudRate: 115200,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
  },

  maxSamples: 200,

  parser: {
    types: [],
    names: [],
    endian: 'little',
  },

  saveFolderPath: null,
  lastError: null,

  isPortBusy: false,  // connecting/disconnecting
};

class StateManager {
  constructor(onChange) {
    this._state = structuredClone(defaultState);
    this._onChange = onChange;  // callback (e.g., broadcast)
  }

  // Get full state (read-only usage)
  get() {
    return this._state;
  }

  // Merge patch into state
  set(patch) {
    this._state = {
      ...this._state,
      ...patch,
    };

    this._emit();
  }

  // Reset to defaults
  reset() {
    this._state = structuredClone(defaultState);
    this._emit();
  }

  // Internal change notifier
  _emit() {
    if (this._onChange) {
      this._onChange(this._state);
    }
  }
}

module.exports = {
  StateManager,
  defaultState,
};
