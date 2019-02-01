const Kaldi = require('./standard_kaldi');

class KaldiQueue {
  constructor() {
    this.queue = [];
    this.promises = [];
  }

  put(item, promise) {
    if (promise) {
      this.promises.push(promise.then(() => {
        this.promises = this.promises.filter(p => p !== promise);
        this.put(item);
      }));
    } else {
      this.queue.push(item);
    }
  }

  get() {
    if (this.queue.length > 0) {
      const item = this.queue.pop();
      return Promise.resolve(item);
    }
    if (this.promises.length === 0) {
      throw new Error('Queue is empty');
    }
    return Promise.race(this.promises).then(() => this.get());
  }

  finish() {
    if (this.promises.length > 0) {
      return Promise.all(this.promises);
    }
    return Promise.resolve();
  }
}

const build = (resources, nthreads = 4, hclgPathIn = null) => {
  const hclgPath = hclgPathIn || resources.fullHclgPath;

  const kaldiQueue = new KaldiQueue();
  for (let i = 0; i < nthreads; i++) {
    const k = new Kaldi(
      resources.nnetGpuPath,
      hclgPath,
      resources.protoLangDir);
    kaldiQueue.put(k, k.start());
  }
  return kaldiQueue;
};

module.exports = { build };
