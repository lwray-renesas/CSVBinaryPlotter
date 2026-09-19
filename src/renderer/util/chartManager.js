export class ChartManager {
  constructor(canvas, signalManager, maxSamples) {
    this.maxSamples = maxSamples;
    this.signalManager = signalManager;
    this.updatePending = false;
    this.yAuto = true;
    this.yMin = 0;
    this.yMax = 100;
    this.y1Auto = true;
    this.y1Min = 0;
    this.y1Max = 100;

    this.chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: [],
        datasets:
            this.signalManager
                .datasets,  // Important - now anything we do to signal manager
                            // datasetswill be reflected in charts datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,

        interaction: {
          intersect: false,
          mode: 'nearest',
        },

        plugins: {
          legend: {
            display: false,
          },

          zoom: {
            pan: {
              enabled: true,
              mode: 'xy',
              onPan: ({chart}) => {
                this.scheduleUpdate();
              },
            },

            zoom: {
              wheel: {enabled: true},

              pinch: {enabled: true},

              drag: {
                enabled: true,
                modifierKey: 'ctrl',
                backgroundColor: 'rgba(59,130,246,0.2)',
                borderColor: '#3b82f6',
                borderWidth: 1,
              },

              mode: 'xy',

              onZoom: ({chart}) => {
                this.scheduleUpdate();
              }
            }
          }
        },

        scales: {
          x: {
            grid: {color: 'rgba(255,255,255,0.05)'},
            ticks: {color: '#94a3b8'},
            type: 'linear',
            bounds: 'data',
          },

          y: {
            display: false,
            grid: {color: 'rgba(255,255,255,0.05)'},
            ticks: {color: '#94a3b8'},
            bounds: 'data',
          },

          y1: {
            display: false,
            position: 'right',
            grid: {drawOnChartArea: false},
            ticks: {color: '#f59e0b'},
            bounds: 'data'
          }
        }
      }
    });
  }

  // Updates y axis scaling parameters.
  updateAxisScaling() {
    const y = this.chart.options.scales.y;
    const y1 = this.chart.options.scales.y1;

    if (this.yAuto) {
      delete y.min;
      delete y.max;
    } else {
      y.min = Math.min(this.yMin, this.yMax);
      y.max = Math.max(this.yMin, this.yMax);
    }

    if (this.y1Auto) {
      delete y1.min;
      delete y1.max;
    } else {
      y1.min = Math.min(this.y1Min, this.y1Max);
      y1.max = Math.max(this.y1Min, this.y1Max);
    }
  }

  // Gets chart canvas context for application to use for interaction handlers.
  getCanvas() {
    return this.chart.canvas;
  }

  isYAxisUsed() {
    return this.signalManager.datasets.some(ds => ds.yAxisID === 'y');
  }

  isY1AxisUsed() {
    return this.signalManager.datasets.some(ds => ds.yAxisID === 'y1');
  }

  // resynchronises the data between SignalManager and ChartManager
  // Effectively force refreshing the displayed data.
  synchronise() {
    // Only display the y axis if a set is using it.
    this.chart.options.scales.y.display = this.isYAxisUsed();
    // Only display the y1 axis if a set is using it.
    this.chart.options.scales.y1.display = this.isY1AxisUsed();

    // Fix y axis scales
    this.updateAxisScaling();

    // Fully rebuild the data from the buffers
    this.rebuildBuffers();

    // Update the visible data area.
    this.updateVisibleData();
  }

  // Fully rebuild the data from the buffers
  rebuildBuffers() {
    this.signalManager.datasets.forEach((dataset, index) => {
      const buffer = this.signalManager.getBuffer(index);
      dataset.data = buffer.map((y, x) => ({x, y}));
    });
  }

  // Updates the visibile data i.e., performs decimation on the sets.
  updateVisibleData() {
    const firstBuffer = this.signalManager.getBuffer(0);

    if (!firstBuffer) {
      this.chart.update('none');
      return;
    }
    const end = Math.max(
        firstBuffer.length,
        this.maxSamples,
    );

    const start = Math.max(
        0,
        end - this.maxSamples,
    );
    const targetPoints = this.chart.width;

    this.signalManager.datasets.forEach((dataset, index) => {
      dataset.data = this.decimateMinMax(
          this.signalManager.getBuffer(index), start, end, targetPoints);
    });

    // Assign chart datasets and update!
    this.chart.update('none');
  }

  // Used to time the chart update with an animation frame and throttle CPU
  // usage.
  scheduleUpdate() {
    if (this.updatePending) {
      return;
    }
    this.updatePending = true;
    requestAnimationFrame(() => {
      this.updatePending = false;
      this.updateVisibleData();
    });
  }

  resetView() {
    // Fully rebuild the data from the buffers
    this.rebuildBuffers();
    // Reset chart zoom
    this.chart.resetZoom();
    // Update the visible data area.
    this.updateVisibleData();
  }

  setDatasetVisibility(index, visible) {
    this.chart.setDatasetVisibility(index, visible);
    this.chart.update();
  }

  isDatasetVisible(index) {
    return this.chart.isDatasetVisible(index);
  }

  decimateMinMax(buffer, start, end, targetPoints) {
    const range = end - start;
    if (range <= targetPoints) {
      const data = [];
      for (let x = start; x < end; x++) {
        data.push({x, y: buffer[x]});
      }
      return data;
    }

    const bucketSize = range / targetPoints;
    const data = [];

    for (let bucket = 0; bucket < targetPoints; bucket++) {
      const bucketStart = Math.floor(start + bucket * bucketSize);
      const bucketEnd =
          Math.min(Math.floor(start + (bucket + 1) * bucketSize), end);

      let minY = Infinity;
      let maxY = -Infinity;
      let minX = bucketStart;
      let maxX = bucketStart;

      for (let x = bucketStart; x < bucketEnd; x++) {
        const y = buffer[x];
        if (y == null) {
          continue;
        }
        if (y < minY) {
          minY = y;
          minX = x;
        }
        if (y > maxY) {
          maxY = y;
          maxX = x;
        }
      }

      if (minY !== Infinity) {
        if (minX < maxX) {
          data.push({x: minX, y: minY});
          data.push({x: maxX, y: maxY});
        } else {
          data.push({x: maxX, y: maxY});
          data.push({x: minX, y: minY});
        }
      }
    }

    return data;
  }
}
