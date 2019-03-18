const { align } = require('./diff_align');
const kaldiQueue = require('./kaldi_queue');
const { makeBigramLanguageModel } = require('./language_model');
const { MetaSentence } = require('./metasentence');
const { realign } = require('./multipass');
const MultiThreadedTranscriber = require('./transcriber');
const { Transcription } = require('./transcription');

class ForcedAligner {
  constructor(options = {}) {
    const {
      resources,
      transcript,
      nthreads,
      ...opts
    } = options;
    this.options = opts;
    this.nthreads = nthreads || 4;
    this.transcript = transcript;
    this.resources = resources;
    this.ms = new MetaSentence(transcript, resources.vocab);
  }

  async transcribe(wavfile, o = {}) {
    const { progress, logging } = o;
    const { resources, nthreads, options } = this;
    const ks = this.ms.getKaldiSequence();
    const genHclgFilename = await makeBigramLanguageModel(ks, resources, options);
    this.queue = kaldiQueue.build(resources, nthreads, genHclgFilename);
    this.mtt = new MultiThreadedTranscriber(this.queue, { nthreads });

    const result = await this.mtt.transcribe(wavfile, progress);
    let { words } = result;
    const { duration } = result;

    // Clear queue (would this be gc'ed?)
    for (let i = 0; i < this.nthreads; i++) {
      // eslint-disable-next-line no-await-in-loop
      const k = await this.queue.get();
      k.stop();
    }

    // Align words
    words = align(words, this.ms, this.options);

    // Perform a second-pass with unaligned words
    if (logging) {
      logging.info(`${words.filter(x => x.notFoundInAudio()).length} unaligned words (of ${words.length})`);
    }

    if (progress) {
      progress({ status: 'ALIGNING' });
    }

    words = await realign(wavfile, words, this.ms, this.resources, this.nthreads, progress);

    if (logging) {
      logging.info(`after 2nd pass: ${words.filter(x => x.notFoundInAudio()).length} unaligned words (of ${words.length})`);
    }

    const opt = new AdjacencyOptimizer(words, duration);
    words = opt.optimize();

    return new Transcription(this.transcript, words);
  }
}

class AdjacencyOptimizer {
  /*
    Sometimes there are ambiguous possible placements of not-found-in-audio
    words.  The word-based diff doesn't take into account intra-word timings
    when it does insertion, so can create strange results.  E.g. if the audio
    contains these words with timings like

        "She climbed on the bed and jumped on the mattress"
            0     1    2   3   4    5   6    7   8     9

    and suppose the speaker mumbled or there was noise obscuring the words
    "on the bed and jumped", so the hypothesis is just "She climbed on the mattress".

    The intended alignment would be to insert the missing out-of-audio words:

        "She climbed [on the bed and jumped] on the mattress"
            0     1                            7   8     9

    But the word-based diff might instead align "on the" with the first
    occurrence, and so insert out-of-audio words like this:

        "She climbed on the [bed and jumped on the] mattress"
            0     1    7   8                             9

    with a big gap in between "climbed" and "on" and no time available for
    "[bend and jumped on the]".

    Or imagine a case such as "I really really really really want to do
    this", where only one of the "really"s is in the hypothesis, so again
    the choice word-based choice of which to align it with is arbitrary.

    This method cleans those up, by checking each not-found-in-audio sequence
    of words to see if its neighbor(s) are candidates for moving inward and
    whether doing so would improve adjacent intra-word distances.
  */

  constructor(words, duration) {
    this.words = words;
    this.duration = duration;
  }

  outOfAudioSequence(i) {
    let j = i;
    while (j >= 0 && j < this.words.length && this.words[j].notFoundInAudio()) {
      j++;
    }
    return j === i ? null : j;
  }

  tend(i) {
    for (let j = i - 1; j >= 0; j--) {
      const word = this.words[j];
      if (word.success()) {
        return word.end;
      }
    }
    return 0;
  }

  tstart(i) {
    for (let j = 0; j < i; j++) {
      const word = this.words[j];
      if (word.success()) {
        return word.start;
      }
    }
  }

  findSubseq(i, j, p, n) {
    for (let k = i; k <= j - n; k++) {
      const { word } = this.words[k];
      if (!this.words.slice(p, p + n).find(w => word !== w.word)) {
        return k;
      }
    }
    return null;
  }

  swapAdjacentIfBetter(i, j, n, side) {
    // Given an out-of-audio sequence at [i,j), looks to see if the adjacent n words
    // can be beneficially swapped with a subsequence.

    // construct adjacent candidate words and their gap relative to their
    // opposite neighbors
    let p;
    let q;
    let oppGap;
    if (side === 'left') {
      p = i - n;
      q = i;
      if (p < 0) {
        return false;
      }
      oppGap = this.tstart(p) - this.tend(p);
    } else {
      p = j;
      q = j + n;
      if (q > this.words.length) {
        return false;
      }
      oppGap = this.tstart(q) - this.tend(q);
    }

    // is there a matching subsequence?
    const k = this.findSubseq(i, j, p, n);
    if (k === null) {
      return false;
    }

    // if the opposite gap isn't bigger than the sequence gap, no benefit to
    // potential swap
    const seqGap = this.tstart(j) - this.tend(i);
    if (oppGap <= seqGap) {
      return false;
    }

    // swap subsequences at p and k
    for (let m  = 0; m < n; m++) {
      this.words[k + m].swapAlignment(this.words[p + m]);
    }

    return true;
  }

  optimizeAdjacent(i, j) {
    // Given an out-of-audio sequence at [i,j), looks for an opportunity to
    // swap a sub-sequence with adjacent words at [p, i) or [j, p)

    for (let n = j - i; n >= 1; n--) { // consider larger moves first
      if (this.swapAdjacentIfBetter(i, j, n, 'left')) {
        return true;
      }
      if (this.swapAdjacentIfBetter(i, j, n, 'right')) {
        return true;
      }
    }
  }

  optimize() {
    let i = 0;
    while (i < this.words.length) {
      const j = this.outOfAudioSequence(i);
      if (j === null) {
        i++;
      } else if (this.optimizeAdjacent(i, j)) {
        // back up to rescan in case we swapped left
        while (i >= 0 && this.words[i].notFoundInAudio()) {
          i--;
        }
      } else {
        i = j; // skip past this sequence
      }
    }
    return this.words;
  }
}

module.exports = {
  ForcedAligner,
  AdjacencyOptimizer,
};
