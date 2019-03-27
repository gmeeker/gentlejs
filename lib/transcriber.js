const logging = require('loglevel');
const { wavInfo, WavBuffer } = require('./wav');
const { Word } = require('./transcription');

class MultiThreadedTranscriber extends WavBuffer {
  constructor(kaldiQueue, options = {}) {
    super();
    this.kaldiQueue = kaldiQueue;
    this.chunkLen = options.chunkLen || 20;
    this.overlapT = options.overlapT || 2;
    this.nthreads = options.nthreads || 4;
  }

  ready(data) {
    const offset = (this.chunkLen - this.overlapT) * this.format.sampleRate;
    const start = this.start / this.format.sampleRate;
    this.start += offset;
    this.end += offset;
    if (data.length < 4000 * 2) {
      logging.info(`Short segment - ignored ${this.chunks.length}`);
      const words = [];
      this.chunks.push({ start, words });
      logging.info(`${this.chunks.length}/${this.nChunks}`);
      if (this.progressCb) {
        this.progressCb({
          message: words.map(X => X.word).join(' '),
          percent: this.chunks.length / this.nChunks
        });
      }
    } else {
      // eslint-disable-next-line no-await-in-loop
      return this.kaldiQueue.get().then(k => {
        k.pushChunk(data).then(() => {
          this.kaldiQueue.put(k, k.getFinal().then(words => {
            this.chunks.push({ start, words });
            logging.info(`${this.chunks.length}/${this.nChunks}`);
            if (this.progressCb) {
              this.progressCb({
                message: words.map(X => X.word).join(' '),
                percent: this.chunks.length / this.nChunks
              });
            }
          }));
        });
      });
    }
    return Promise.resolve();
  }

  transcribe(wavfile, progressCb) {
    this.progressCb = progressCb;
    return wavInfo(wavfile).then(format => {
      this.format = format;
      const { duration } = format;
      this.chunks = [];
      this.nChunks = Math.ceil(duration / (this.chunkLen - this.overlapT));

      this.start = 0;
      this.end = format.sampleRate * this.chunkLen;
      return this.read(wavfile).then(() => this.kaldiQueue.finish());
    }).then(() => {
      const { format } = this;
      this.chunks.sort((a, b) => a.start - b.start);
      return this.transcribeCombine(this.chunks, format.duration);
    });
  }

  transcribeCombine(chunks, duration) {
    // Combine chunks
    let words = [];
    chunks.forEach((c, index) => {
      const chunkStart = c.start;
      const chunkEnd = chunkStart + this.chunkLen;

      const chunkWords = c.words.map(wd => {
        const w = new Word(wd);
        return w.shift({ time: chunkStart });
      });

      // At chunk boundary cut points the audio often contains part of a
      // word, which can get erroneously identified as one or more different
      // in-vocabulary words.  So discard one or more words near the cut points
      // (they'll be covered by the ovlerap anyway).
      //
      const trim = Math.min(0.25 * this.overlapT, 0.5);
      if (index !== 0) {
        while (chunkWords.length > 1) {
          chunkWords.shift();
          if (chunkWords[0].end > chunkStart + trim) {
            break;
          }
        }
      }
      if (index !== chunks.length - 1) {
        while (chunkWords.length > 1) {
          chunkWords.pop();
          if (chunkWords[chunkWords.length - 1].start < chunkEnd - trim) {
            break;
          }
        }
      }

      words = words.concat(chunkWords);
    });

    // Remove overlap:  Sort by time, then filter out any Word entries in
    // the list that are adjacent to another entry corresponding to the same
    // word in the audio.
    words.sort((a, b) => a.start - b.start);
    words.push(new Word({ word: '__dummy__' }));
    words = words.filter((word, i) => i + 1 < words.length && !word.corresponds(words[i + 1]));

    return { words, duration };
  }
}

module.exports = MultiThreadedTranscriber;
