const Kaldi = require('./standard_kaldi');

class KaldiQueue {
  constructor() {
    this.queue = [];
    this.promises = [];
  }

  put(item, promise) {
    if (promise) {
      // console.log('put() promise', item, promise);
      this.promises.push(promise.then(() => this.put(item)));
    } else {
      // console.log('put()', item);
      this.queue.push(item);
    }
  }

  get() {
    if (this.queue.length > 0) {
      const item = this.queue.pop();
      // console.log('get()', item);
      return Promise.resolve(item);
    }
    if (this.promises.length === 0) {
      // console.log('get() empty');
      throw new Error('Queue is empty');
    }
    // console.log('get() wait');
    return Promise.race(this.promises).then(() => this.get());
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
