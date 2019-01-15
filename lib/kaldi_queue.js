const Kaldi = require('./standard_kaldi');

class KaldiQueue {
  constructor() {
    this.queue = [];
    this.promises = [];
  }

  put(item, promise) {
    if (promise) {
      this.promises.push(promise.then(() => this.put(item)));
    }
    this.queue.push(item);
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
}

const build = (resources, nthreads = 4, hclgPathIn = null) => {
  const hclgPath = hclgPathIn || resources.fullHclgPath;

  const kaldiQueue = new KaldiQueue();
  for (let i = 0; i < nthreads; i++) {
    kaldiQueue.put(new Kaldi(
      resources.nnetGpuPath,
      hclgPath,
      resources.protoLangdir));
  }
  return kaldiQueue;
};

module.exports = { build };
