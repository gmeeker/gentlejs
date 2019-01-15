const fs = require('fs-extra');
const logging = require('loglevel');
const wav = require('wav');
const { Word } = require('./transcription');

class MultiThreadedTranscriber {
  constructor(kaldiQueue, options = {}) {
    this.kaldiQueue = kaldiQueue;
    this.chunkLen = options.chunkLen || 20;
    this.overlapT = options.overlapT || 2;
    this.nthreads = options.nthreads || 4;
  }

  transcribe(wavfile, progressCb) {
    this.buffer = undefined;
    const file = fs.createReadStream(wavfile);
    // Duration is not available in advance so estimate.
    // It's just for progress anyway.
    return fs.stat(wavfile).then(stat => {
      const { size } = stat;
      const reader = new wav.Reader();
      let format;
      const chunks = [];
      let nChunks;
      let startT = 0;
      let samples = 0;
      let byteRate;
      return new Promise((resolve, reject) => {
        reader.on('format', f => {
          format = f;
          ({ byteRate } = f);
          const duration = size / format.byteRate;
          nChunks = Math.ceil(duration / (this.chunkLen - this.overlapT));
        });
        reader.on('readable', () => {
          const loop1 = () => {
            const data = reader.read(this.chunkLen * byteRate);
            if (data) {
              samples += data.length / byteRate;
              if (this.buffer) {
                this.buffer = Buffer.concat([this.buffer, data]);
              } else {
                this.buffer = data;
              }
              const loop2 = () => {
                if (this.buffer.length < 4000) {
                  logging.info(`Short segment - ignored ${chunks.length}`);
                  const words = [];
                  const start = startT;
                  chunks.push({ start, words });
                  logging.info(`${chunks.length}/${nChunks}`);
                  if (progressCb) {
                    progressCb({
                      message: words.map(X => X.word).join(' '),
                      percent: chunks.length / nChunks
                    });
                  }
                } else {
                  const buf = this.buffer.slice(0, this.chunkLen * byteRate);
                  const start = startT;
                  startT += this.chunkLen - this.overlapT;
                  this.kaldiQueue.get().then(k => {
                    k.pushChunk(buf);
                    this.kaldiQueue.put(k, k.getFinal().then(words => {
                      chunks.push({ start, words });
                      logging.info(`${chunks.length}/${nChunks}`);
                      if (progressCb) {
                        progressCb({
                          message: words.map(X => X.word).join(' '),
                          percent: chunks.length / nChunks
                        });
                      }
                    }));
                  });
                  this.buffer = this.buffer.slice((this.chunkLen - this.overlapT) * byteRate);
                }
              };
              return loop2().then(() => loop1());
            }
          };
          loop1();
        });
        reader.on('end', () => {
          resolve();
        });
        reader.on('error', err => reject(err));
        file.pipe(reader);
      }).then(() => this.transcribeCombine(chunks, samples / format.sampleRate));
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
            return;
          }
        }
      }
      if (index !== chunks.length - 1) {
        while (chunkWords.length > 1) {
          chunkWords.pop();
          if (chunkWords[chunkWords.length - 1].start < chunkEnd - trim) {
            return;
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
    words = words.filter((word, i) => !word.corresponds(words[i + 1]));

    return { words, duration };
  }
}

module.exports = MultiThreadedTranscriber;
