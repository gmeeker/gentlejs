const kaldiQueue = require('./kaldi_queue');
const MultiThreadedTranscriber = require('./transcriber');
const { Transcription, Word } = require('./transcription');

class FullTranscriber {
  constructor(resources, options = {}) {
    const nthreads = options.nthreads || 2;
    this.available = false;
    if (nthreads <= 0) {
      return;
    }
    // if not os.path.exists(resources.full_hclg_path): return

    const queue = kaldiQueue.build(resources, nthreads);
    this.mtt = new MultiThreadedTranscriber(queue, { nthreads });
    this.available = true;
  }

  transcribe(wavfile, progressCb) {
    const { words } = this.mtt.transcribe(wavfile, progressCb);
    return this.make_transcription_alignment(words);
  }

  makeTranscriptionAlignment(trans) {
    // Spoof the `diff_align` output format
    let transcript = '';
    const words = [];
    trans.forEach(tWd => {
      const word = new Word({
        case: Word.SUCCESS(),
        startOffset: transcript.length,
        endOffset: transcript.length + tWd.word.length,
        word: tWd.word,
        alignedWord: tWd.word,
        phones: tWd.phones,
        start: tWd.start,
        end: tWd.end,
      });
      words.append(word);

      transcript += word.word + ' ';
    });

    return new Transcription(words, transcript);
  }
}

module.exports = FullTranscriber;
