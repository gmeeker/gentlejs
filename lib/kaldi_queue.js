const Kaldi = require('./standard_kaldi');

class KaldiQueue {
  constructor() {
    this.queue = [];
    this.promises = [];
    this.nextKey = 0;
  }

  put(item) {
    this.queue.push(item);
  }

  putAsync(item) {
    const key = this.nextKey;
    const result = { item, key };
    this.nextKey++;
    if (this.nextKey >= 0x10000000) {
      this.nextKey = 0;
    }
    result.promise = new Promise(resolve => {
      result.resolve = resolve;
    }).then(() => {
      this.promises = this.promises.filter(p => p.key !== key);
      this.put(item);
    });
    this.promises.push(result);
    return result.resolve;
  }

  get() {
    if (this.queue.length > 0) {
      const item = this.queue.pop();
      return Promise.resolve(item);
    }
    if (this.promises.length === 0) {
      throw new Error('Queue is empty');
    }
    return Promise.race(this.promises.map(p => p.promise)).then(() => this.get());
  }

  finish() {
    if (this.promises.length > 0) {
      return Promise.all(this.promises.map(p => p.promise));
    }
    return Promise.resolve();
  }
}

const build = (resources, nthreads = 4, hclgPathIn = null) => {
  const hclgPath = hclgPathIn || resources.fullHclgPath;

  const kaldiQueue = new KaldiQueue();
  for (let i = 0; i < nthreads; i++) {
    const k = new Kaldi(
      resources,
      hclgPath,
      resources.protoLangDir);
    kaldiQueue.put(k, k.start());
  }
  return kaldiQueue;
};

module.exports = { KaldiQueue, build };
