const fs = require('fs-extra');
const wav = require('wav');

const wavHeader = filename => {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filename);
    const reader = new wav.Reader();
    reader.on('format', format => {
      stream.unpipe();
      reader.end();
      resolve(format);
    });
    reader.on('error', err => {
      stream.unpipe();
      reader.end();
      reject(err);
    });
    stream.pipe(reader);
  });
};

const wavStream = (filename, cb) => {
  let format;
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filename);
    const reader = new wav.Reader();
    reader.on('format', f => {
      format = f;
    });
    reader.on('readable', () => {
      const loop = () => {
        const data = reader.read();
        if (data) {
          cb(format, data).then(() => loop());
        }
      };
      loop();
    });
    reader.on('end', () => {
      stream.unpipe();
      reader.end();
      if (format) {
        cb(format).then(() => resolve(format));
      } else {
        resolve(format);
      }
    });
    reader.on('error', err => {
      stream.unpipe();
      reader.end();
      reject(err);
    });
    stream.pipe(reader);
  });
};

const wavInfo = filename => {
  let bytes = 0;
  return wavStream(filename, (format, data) => {
    if (data) {
      bytes += data.length;
    }
  }).then(format => {
    if (format) {
      const { channels, bitDepth, sampleRate } = format;
      const duration = Math.floor(bytes / channels / (bitDepth / 8)) / sampleRate;
      return { ...format, duration };
    }
  });
};

class WavBuffer {
  constructor() {
    this.buffers = [];
    this.pos = 0;
    this.addBuffer = this.addBuffer.bind(this);
  }

  ready() {
    return Promise.resolve();
  }

  drain(format, data) {
    if (this.start !== undefined && this.end !== undefined) {
      const { channels, bitDepth } = format;
      const frameSize = channels * (bitDepth / 8);
      const start = this.start * frameSize;
      const end = this.end * frameSize;
      // Remove any unnecessary buffers
      while (this.buffers.length > 0 && this.pos + this.buffers[0].length < start) {
        this.pos += this.buffers[0].length;
        this.buffers.shift();
      }
      const length = this.buffers.reduce((acc, buf) => acc + buf.length, 0);
      if (start < this.pos + length && (!data || end < this.pos + length)) {
        const buf = Buffer.concat(this.buffers).slice(start - this.pos, end - this.pos);
        return this.ready(buf).then(() => this.drain(format, data));
      }
    }
    return Promise.resolve();
  }

  addBuffer(format, data) {
    if (data) {
      this.buffers.push(data);
    }
    return this.drain(format, data);
  }

  read(filename) {
    return wavStream(filename, this.addBuffer);
  }
}

module.exports = {
  wavHeader,
  wavInfo,
  wavStream,
  WavBuffer,
};
