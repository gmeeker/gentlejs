const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const logging = require('loglevel');
const { getBinary } = require('./util');

class Kaldi {
  constructor(nnetDir, hclgPath) {
    this.nnetDir = nnetDir;
    this.hclgPath = hclgPath;
    this.waitFinish = null;
    this.waitLine = null;
    this.lines = [];
  }

  async start() {
    const cmd = await getBinary(path.join('ext', 'k3'));
    const args = [];

    if (this.nnetDir) {
      args.push(this.nnetDir);
      args.push(this.hclgPath);
    }

    await fs.stat(this.hclgPath)
      .catch(() => {
        logging.error(`hclgPath does not exist: ${this.hclgPath}`);
      });
    this.p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    this.p.stdout.on('readable', () => {
      const buffers = [];
      let buf;
      while (buf !== null) {
        buf = this.p.stdout.read();
        if (buf) {
          buffers.push(buf);
        }
      }
      if (buffers.length > 0) {
        const lines = Buffer.concat(buffers).toString().split(/\r\n|\r|\n/);
        this.lines = this.lines.concat(lines);
        if (this.waitLine) {
          this.waitLine();
        }
      }
    });
    this.waitFinish = new Promise(resolve => {
      this.p.on('exit', () => {
        this.waitFinish = null;
        this.p.stdout.removeListener('readable');
        resolve();
      });
    });
  }

  readline() {
    if (this.lines.length > 0) {
      return Promise.resolve(this.lines.shift());
    }
    return new Promise(resolve => {
      this.waitLine = resolve;
    }).then(() => {
      this.waitLine = null;
      return this.readline();
    });
  }

  cmd(c) {
    this.p.stdin.write(c + '\n');
  }

  async pushChunk(buf) {
    // Wait until we're ready
    this.cmd('push-chunk');

    const cnt = Math.floor(buf.length / 2);
    this.cmd(cnt.toString());
    this.p.stdin.write(buf); // arr.tostring()
    return this.readline().then(line => {
      const status = line.trim();
      return status === 'ok';
    });
  }

  async getFinalReadLines() {
    const words = [];
    let done = false;
    while (!done) {
      // eslint-disable-next-line no-await-in-loop
      const line = await this.readline();
      const parts = line.split(' / ');
      if (line.startsWith('done')) {
        done = true;
      } else if (line.startsWith('word')) {
        const wd = {};
        const [part0, part1, part2] = parts;
        [, wd.word] = part0.split(': ');
        wd.start = parseFloat(part1.split(': ')[1]);
        wd.duration = parseFloat(part2.split(': ')[1]);
        wd.phones = [];
        words.push(wd);
      } else if (line.startsWith('phone')) {
        const ph = {};
        const [part0, part1] = parts;
        [, ph.phone] = part0.split(': ');
        ph.duration = parseFloat(part1.split(': ')[1]);
        words[words.length - 1].phones.push(ph);
      }
    }

    return words;
  }

  getFinal() {
    this.cmd('get-final');
    return this.getFinalReadLines()
      .then(words => {
        this.reset();
        return words;
      });
  }

  reset() {
    this.cmd('reset');
  }

  async stop() {
    if (this.waitFinish) {
      this.cmd('stop');
      return this.waitFinish;
    }
  }
}

module.exports = Kaldi;
