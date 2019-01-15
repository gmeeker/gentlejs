const fs = require('fs-extra');
const logging = require('loglevel');
const wav = require('wav');
const { align } = require('./diff_align');
const { makeBigramLanguageModel } = require('./language_model');
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

  if (curUnalignedWords > 0) {
    toRealign.push({
      start: lastAlignedWord,
      end: null,
      words: curUnalignedWords,
    });
  }

  return toRealign;
};

const realign = (wavfile, alignment, ms, resources, nthreads = 4, progressCb = null) => {
  const frameSize = 2; // mono, 16-bit only
  const toRealign = prepareMultipass(alignment);
  const realignments = [];

  let buffer;
  let offset = 0;
  const file = fs.createReadStream(wavfile);
  const reader = new wav.Reader();
  let byteRate;
  const promises = [];
  for (let i = 0; i < nthreads; i++) {
    promises.push(Promise.resolve(i));
  }
  return new Promise((resolve, reject) => {
    reader.on('format', f => {
      ({ byteRate } = f);
    });
    reader.on('readable', async () => {
      let data;
      while (data !== null) {
        data = reader.read(1024);
        if (data) {
          if (buffer) {
            buffer = Buffer.concat([buffer, data]);
          } else {
            buffer = data;
          }
          while (toRealign.length > 0) {
            const chunk = toRealign.shift();
            const startT = chunk.start ? chunk.start.end : 0;
            const endT = chunk.end ? chunk.end.start : null;
            if (offset + buffer.length >= startT * byteRate
                && (endT === null ? (data === null) : (offset + buffer.length >= endT * byteRate))) {
              const buf = buffer.slice(startT * byteRate, endT === null ? undefined : endT * byteRate);
              const duration = endT - startT;
              // XXX: the minimum length seems bigger now (?)
              if (duration < 0.75 || duration > 60) {
                logging.debug(`cannot realign ${chunk.words.length} words with duration ${duration}`);
                continue;
              }

              buffer = buffer.slice(startT * byteRate);

              // Create a language model
              const { startOffset } = chunk.words[0];
              const chunkLen = chunk.words[chunk.words.length - 1].endOffset - startOffset;
              const chunkTranscript = ms.rawSentence.substr(startOffset, chunkLen);
              const chunkMs = new MetaSentence(chunkTranscript, resources.vocab);
              const chunkKs = chunkMs.getKaldiSequence();

              const chunkGenHclgFilename = makeBigramLanguageModel(chunkKs, resources.protoLangDir);
              // eslint-disable-next-line no-await-in-loop
              const i = await Promise.race(promises);
              const k = new Kaldi(resources.nnetGpuPath, chunkGenHclgFilename);
              promises[i] = k.pushChunk(buf)
                .then(() => k.getFinal())
                .then(final => {
                  const ret = final.map(wd => new Word(wd));
                  k.stop();

                  const wordAlignment = align(ret, chunkMs);

                  wordAlignment.forEach(wd => {
                    wd.shift({ time: startT, offset: startOffset });
                  });

                  // "chunk" should be replaced by "words"
                  realignments.push({ chunk, words: wordAlignment });

                  if (progressCb) {
                    progressCb({ percent: realignments.length / toRealign.length });
                  }
                });
            }
          }
          offset += data.length / frameSize;
        }
      }
    });
    reader.on('end', () => {
      resolve();
    });
    reader.on('error', err => reject(err));
    file.pipe(reader);
  }).then(() => {
    // Sub in the replacements
    let oWords = alignment;
    realignments.forEach(ret => {
      const stIdx = oWords.index(ret.chunk.words[0]);
      const endIdx = oWords.index(ret.chunk.words[-1]) + 1;
      // logging.debug('splice in: "%s' % (str(ret["words"])))
      // logging.debug('splice out: "%s' % (str(o_words[st_idx:end_idx])))
      oWords = oWords.slice(0, stIdx).concat(ret.words, oWords.slice(endIdx));
    });

    return oWords;
  });
};

module.exports = {
  prepareMultipass,
  realign,
};
