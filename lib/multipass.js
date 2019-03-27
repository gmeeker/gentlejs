const logging = require('loglevel');
const { wavInfo, WavBuffer } = require('./wav');
const { align } = require('./diff_align');
const { makeBigramLanguageModel } = require('./language_model');
const { KaldiQueue } = require('./kaldi_queue');
const { MetaSentence } = require('./metasentence');
const Kaldi = require('./standard_kaldi');
const { Word } = require('./transcription');

const prepareMultipass = alignment => {
  const toRealign = [];
  let lastAlignedWord = null;
  let curUnalignedWords = [];

  alignment.forEach(wd => {
    if (wd.notFoundInAudio()) {
      curUnalignedWords.push(wd);
    } else if (wd.success()) {
      if (curUnalignedWords.length > 0) {
        toRealign.push({
          start: lastAlignedWord,
          end: wd,
          words: curUnalignedWords,
        });
        curUnalignedWords = [];
      }

      lastAlignedWord = wd;
    }
  });

  if (curUnalignedWords.length > 0) {
    toRealign.push({
      start: lastAlignedWord,
      end: null,
      words: curUnalignedWords,
    });
  }

  return toRealign;
};

class Realigner extends WavBuffer {
  constructor(nthreads = 4) {
    super();
    this.kaldiQueue = new KaldiQueue();
    for (let i = 0; i < nthreads; i++) {
      this.kaldiQueue.put(null);
    }
  }

  async ready(data) {
    const { resources } = this;
    const chunk = this.toRealign.shift();
    if (this.toRealign.length > 0) {
      const range = this.getChunkRange(this.toRealign[0]);
      this.start = Math.floor(this.format.sampleRate * range.startT);
      this.end = Math.ceil(this.format.sampleRate * range.endT);
    } else {
      this.start = undefined;
      this.end = undefined;
    }
    const { startT, duration } = this.getChunkRange(chunk);
    // XXX: the minimum length seems bigger now (?)
    if (duration < 0.75 || duration > 60) {
      logging.debug(`cannot realign ${chunk.words.length} words with duration ${duration}`);
      return Promise.resolve();
    }

    // Create a language model
    const { startOffset } = chunk.words[0];
    const chunkLen = chunk.words[chunk.words.length - 1].endOffset - startOffset;
    const chunkTranscript = this.ms.rawSentence.substr(startOffset, chunkLen);
    const chunkMs = new MetaSentence(chunkTranscript, resources.vocab);
    const chunkKs = chunkMs.getKaldiSequence();

    const chunkGenHclgFilename = await makeBigramLanguageModel(chunkKs, resources);
    return this.kaldiQueue.get().then(() => {
      const k = new Kaldi(resources, chunkGenHclgFilename);
      return k.start().then(() => {
        k.pushChunk(data).then(() => {
          this.kaldiQueue.put(null, k.getFinal().then(final => {
            const ret = final.map(wd => new Word(wd));
            k.stop();

            const wordAlignment = align(ret, chunkMs);

            wordAlignment.forEach(wd => {
              wd.shift({ time: startT, offset: startOffset });
            });

            // "chunk" should be replaced by "words"
            this.realignments.push({ chunk, words: wordAlignment });

            if (this.progressCb) {
              this.progressCb({ percent: this.realignments.length / this.count });
            }
          }));
        });
      });
    });
  }

  getChunkRange(chunk) {
    const startT = chunk.start ? chunk.start.end : 0;
    const endT = chunk.end ? chunk.end.start : this.format.duration;
    const duration = endT - startT;

    return { startT, endT, duration };
  }

  realign(wavfile, alignment, ms, resources, progressCb = null) {
    this.ms = ms;
    this.resources = resources;
    this.progressCb = progressCb;

    this.toRealign = prepareMultipass(alignment);
    this.count = this.toRealign.length;
    this.realignments = [];
    if (this.toRealign.length === 0) {
      return Promise.resolve([]);
    }
    return wavInfo(wavfile).then(format => {
      this.format = format;

      const range = this.getChunkRange(this.toRealign[0]);
      this.start = Math.floor(format.sampleRate * range.startT);
      this.end = Math.ceil(format.sampleRate * range.endT);
      return this.read(wavfile).then(() => this.kaldiQueue.finish());
    }).then(() => {
      // Sub in the replacements
      let oWords = alignment;
      this.realignments.forEach(ret => {
        const { words } = ret.chunk;
        const stIdx = oWords.indexOf(words[0]);
        const endIdx = oWords.indexOf(words[words.length - 1]) + 1;
        // logging.debug('splice in: "%s' % (str(ret["words"])))
        // logging.debug('splice out: "%s' % (str(o_words[st_idx:end_idx])))
        oWords = oWords.slice(0, stIdx).concat(ret.words, oWords.slice(endIdx));
      });

      return oWords;
    });
  }
}

const realign = (wavfile, alignment, ms, resources, nthreads = 4, progressCb = null) => {
  const r = new Realigner(nthreads);
  return r.realign(wavfile, alignment, ms, resources, progressCb);
};

module.exports = {
  prepareMultipass,
  realign,
};
