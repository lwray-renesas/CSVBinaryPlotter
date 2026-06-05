const ESC = 0x5C;
const MASK = 0x20;

const TYPES = {
  u8: {size: 1, little: (b) => b.readUInt8(0), big: (b) => b.readUInt8(0)},
  i8: {size: 1, little: (b) => b.readInt8(0), big: (b) => b.readInt8(0)},

  u16: {
    size: 2,
    little: (b) => b.readUInt16LE(0),
    big: (b) => b.readUInt16BE(0)
  },
  i16: {size: 2, little: (b) => b.readInt16LE(0), big: (b) => b.readInt16BE(0)},

  u32: {
    size: 4,
    little: (b) => b.readUInt32LE(0),
    big: (b) => b.readUInt32BE(0)
  },
  i32: {size: 4, little: (b) => b.readInt32LE(0), big: (b) => b.readInt32BE(0)},

  u64: {
    size: 8,
    little: (b) => Number(b.readBigUInt64LE(0)),
    big: (b) => Number(b.readBigUInt64BE(0))
  },
  i64: {
    size: 8,
    little: (b) => Number(b.readBigInt64LE(0)),
    big: (b) => Number(b.readBigInt64BE(0))
  },

  f32: {size: 4, little: (b) => b.readFloatLE(0), big: (b) => b.readFloatBE(0)},
  f64: {
    size: 8,
    little: (b) => b.readDoubleLE(0),
    big: (b) => b.readDoubleBE(0)
  },
};

class CsvBinaryParser {
  /**
   * @param {Object} options
   * @param {(values:number[]) => void} options.onRow
   * @param {(values:[]) => void} options.onMeta
   */
  constructor({onRow, onMeta}) {
    this.onRow = onRow;
    this.onMeta = onMeta;

    this.names = null;
    this.types = null;
    this.endian = null;

    this.columnReaders = null;
    this.columnSizes = null;

    this.escape = false;
    this.currentField = [];
    this.currentRow = [];
    this.synched = false;

    this.inMeta = false;
    this.metaBuffer = '';
  }

  /**
   * Push incoming serial Buffer
   */
  push(buffer) {
    for (const byte of buffer) {
      if (this.inMeta) {
        if (byte === 0x0A) {  // '\n'
          this._handleMeta(this.metaBuffer);
          this.metaBuffer = '';
          this.inMeta = false;
        } else {
          this.metaBuffer += String.fromCharCode(byte);
        }
      } else {
        // If not synhced, discard until newline
        if (byte === 0x23) {  // '#'
          this.inMeta = true;
          this.metaBuffer = '';
        } else {
          if (!this.synched) {
            if (byte === 0x0A) {  // '\n'
              this.synched = true;
            }
          } else {
            if (this.escape) {
              this.currentField.push(byte ^ MASK);
              this.escape = false;
            } else if (byte === ESC) {
              this.escape = true;
            } else if (byte === 0x2C) {  // ','
              this._finishField();
            } else if (byte === 0x0A) {  // '\n'
              this._finishField();
              this._finishRow();
            } else {
              this.currentField.push(byte);
            }
          }
        }
      }
    }
  }

  /**
   * Reset parser state
   */
  reset() {
    this.escape = false;
    this.currentField = [];
    this.currentRow = [];
    this.synched = false;
    this.inMeta = false;
  }

  /**
   * Finish current field
   */
  _finishField() {
    this.currentRow.push(Buffer.from(this.currentField));
    this.currentField = [];
  }

  /**
   * Finish row and emit parsed values
   */
  _finishRow() {
    try {
      const values = this._parseRow(this.currentRow);
      this.currentRow = [];
      if (this.onRow) {
        this.onRow(values);
      }
    } catch (err) {
      this.currentRow = [];
      // TODO: Silent failure might be best?
    }
  }

  /**
   * Convert buffers → typed values
   */
  _parseRow(fields) {
    if (!this.columnReaders) {
      throw new Error('Format not initialised (missing #T/#E)');
    }

    const values = new Array(fields.length);

    for (let i = 0; i < fields.length; i++) {
      const buf = fields[i];

      const expectedSize = this.columnSizes[i];
      const reader = this.columnReaders[i];

      if (!reader) {
        throw new Error(`Missing reader for column ${i}`);
      }

      if (buf.length < expectedSize) {
        throw new Error(`Field ${i} too small (got ${buf.length}, expected ${
            expectedSize})`);
      }

      values[i] = reader(buf);
    }

    return values;
  }


  /*
   * Builds formatter to parse csv data according to meta data exchange
   */
  _rebuildFormat() {
    if (!this.types || !this.endian) return;

    this.columnReaders = this.types.map(typeName => {
      const type = TYPES[typeName];
      if (!type) {
        throw new Error(`Unknown type: ${typeName}`);
      }
      return type[this.endian];
    });

    this.columnSizes = this.types.map(typeName => TYPES[typeName].size);
  }


  /**
   * Handles Meta Data describing csv info to parse
   */
  _handleMeta(line) {
    // line starts AFTER '#'
    const type = line[0];
    const payload = line.slice(1);

    const parts = payload.split(',').filter(Boolean);

    switch (type) {
      case 'N':
        this.names = parts;
        this.onMeta?.({type: 'names', data: parts});
        break;

      case 'T':
        this.types = parts;
        this._rebuildFormat();
        this.onMeta?.({type: 'types', data: parts});
        break;

      case 'E':
        this.endian = payload.trim();
        this._rebuildFormat();
        this.onMeta?.({type: 'endian', data: this.endian});
        break;

      default:
        // ignore unknown
        break;
    }
  }
}

module.exports = {CsvBinaryParser};
