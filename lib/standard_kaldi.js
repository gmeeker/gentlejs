const fs = require('fs-extra');
const { spawn } = require('child_process');
const logging = require('loglevel');

class Kaldi {
  constructor(resources, hclgPath) {
    this.resources = resources;
    this.nnetDir = resources.nnetGpuPath;
    this.hclgPath = hclgPath;
    this.waitFinish = null;
    this.waitLine = null;
    this.lines = [];
    this.buffers = [];
    this.lineIndex = 0;
  }

  async start() {
    const cmd = await this.resources.getBinary('k3');
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
    // Stop errors from terminating us.
    this.p.stdin.on('error', () => {});
    this.p.stdout.on('error', () => {});
    this.p.stdout.on('readable', () => {
      let buf;
      while (this.p && buf !== null) {
        buf = this.p.stdout.read();
        if (buf) {
          this.buffers.push(buf);
        }
      }
      if (this.buffers.length > 0) {
        // Due to UTF-8 we need to process entire buffer list together.
        // Only reset when we end at a line break.
        const lines = Buffer.concat(this.buffers).toString().split(/\r\n|\r|\n/);
        if (lines.length > 1) {
          const moreLines = lines.slice(this.lineIndex, -1);
          this.lines = this.lines.concat(moreLines);
          this.lineIndex += moreLines.length;
          // Empty string means buffers ended with newline.
          if (!lines[lines.length - 1]) {
            this.buffers = [];
            this.lineIndex = 0;
          }
        }
        if (this.lines.length > 0) {
          if (this.waitLine) {
            this.waitLine();
          }
        }
      }
    });
    this.waitFinish = new Promise(resolve => {
      let resolved = false;
      this.p.on('error', () => {
        if (!resolved) {
          resolved = true;
          this.waitFinish = null;
          this.p = null;
          resolve();
        }
      });
      this.p.on('exit', () => {
        if (!resolved) {
          resolved = true;
          this.waitFinish = null;
          this.p = null;
          resolve();
        }
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
