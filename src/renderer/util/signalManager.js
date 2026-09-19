// Class used to store signal data (meta and raw)
export class Signal {
  constructor(header, buffer, colour) {
    this.buffer = buffer;
    this.dataset = {
      label: header,
      rawHeader: header,
      data: buffer.map((y, x) => ({x, y})),
      borderColor: colour,
      borderWidth: 2,
      pointRadius: 0,
      yAxisID: 'y',
      order: 0
    };
  }
}

// Class used to manage set of signals
export class SignalManager {
  constructor() {
    this.signals = [];
    this.datasets = [];
    this.order = [];
  }

  get count() {
    return this.signals.length;
  }

  // Adds a new signal for the manager.
  addSignal(header, buffer, colour) {
    const signal = new Signal(header, buffer, colour);
    signal.dataset.order = this.count;
    this.signals.push(signal);
    this.datasets.push(signal.dataset);
    this.order.push(this.count - 1);
  }

  // removes signal from manager according to its index in the local array
  removeSignal(index) {
    this.order = this.order.filter(i => i !== index);
    this.order = this.order.map(i => i > index ? i - 1 : i);
    this.signals.splice(index, 1);
    this.datasets.splice(index, 1);
  }

  // moves the signal inside the local array (uses order array for lookup and
  // tracking)
  moveSignal(fromVisualIndex, toVisualIndex) {
    const moved = this.order.splice(fromVisualIndex, 1)[0];
    this.order.splice(toVisualIndex, 0, moved);
    this.order.forEach((signalIndex, order) => {
      this.signals[signalIndex].dataset.order = order;
    });
  }

  // removes group of signals
  removeRange(start, count) {
    this.order =
        this.order.filter(index => index < start || index >= start + count);
    this.order = this.order.map(index => index > start ? index - count : index);
    this.signals.splice(start, count);
    this.datasets.splice(start, count);
  }

  // Gets specific signal by index
  getSignal(index) {
    return this.signals[index];
  }

  // Gets specific dataset by index
  getDataset(index) {
    return this.datasets[index];
  }

  // Gets specific rawbuffer by index
  getBuffer(index) {
    return this.signals[index]?.buffer;
  }

  // Gets visual items based on their order (array of indexes used for
  // presentation order)
  visualItems() {
    return this.order.map(index => ({index, signal: this.signals[index]}));
  }
}
