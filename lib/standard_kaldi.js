const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const logging = require('loglevel');
const { getBinary } = require('./util');

class Kaldi {
  constructor(nnetDir, hclgPath) {
    this.nnetDir = nnetDir;
    this.hclgPath = hclgPath;
    this.finished = true;
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
    this.finished = false;
  }

  cmd(c) {
    this.p.stdin.write(c + '\n');
  }

  async pushChunk(buf) {
    return new Promise(resolve => {
      const callback = data => {
        this.p.stdout.pause();
        this.p.stdout.removeListener(callback);
        resolve(data);
      };
      this.p.stdout.on('data', callback);

      // Wait until we're ready
      this.cmd('push-chunk');

      const cnt = Math.floor(buf.length / 2);
      this.cmd(cnt.toString());
      this.p.stdin.write(buf); // arr.tostring()
    }).then(data => {
      const status = data.toString().trim();
      return status === 'ok';
    });
  }

  async getFinal() {
    return new Promise(resolve => {
      const callback = data => {
        this.p.stdout.pause();
        this.p.stdout.removeListener(callback);
        resolve(data);
      };
      this.p.stdout.on('data', callback);

      this.cmd('get-final');
    }).then(data => {
      const words = [];
      const line = data.toString();
      if (line.startsWith('done')) {
        return;
      }
      const parts = line.split(' / ');
      if (line.startsWith('word')) {
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
        words[-1].phones.push(ph);
      }

      this.reset();
      return words;
    });
  }

  reset() {
    this.cmd('reset');
  }

  async stop() {
    if (!this.finished) {
      return new Promise(resolve => {
        this.p.on('exit', () => resolve());
        this.finished = true;
        this.cmd('stop');
      });
    }
  }
}

module.exports = Kaldi;
