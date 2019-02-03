const { SequenceMatcher } = require('difflib');
const { Word } = require('./transcription');

// TODO(maxhawkins): try using the (apparently-superior) time-mediated dynamic
// programming algorithm used in sclite's alignment process:
//  http://www1.icsi.berkeley.edu/Speech/docs/sctk-1.2/sclite.htm#time-mediated
const align = (alignment, ms, options = {}) => {
  // Use the diff algorithm to align the raw tokens recognized by Kaldi
  // to the words in the transcript (tokenized by MetaSentence).

  // The output combines information about the timing and alignment of
  // correctly-aligned words as well as words that Kaldi failed to recognize
  // and extra words not found in the original transcript.
  const disfluency = options.disfluency || false;
  const disfluencies = options.disfluencies || [];

  const hypothesis = alignment.map(X => X.word);
  const reference = ms.getKaldiSequence();

  const displaySeq = ms.getDisplaySequence();
  const txtOffsets = ms.getTextOffsets();

  const out = [];
  const iterator = wordDiff(hypothesis, reference);
  let diff = { done: false };
  while (!diff.done) {
    diff = iterator.next();
    const [op, a, b] = diff.value;

    let word;
    if (op === 'delete') {
      word = hypothesis[a];
      if (disfluency && disfluencies.includes(word)) {
        const hypToken = alignment[a];
        const phones = hypToken.phones || [];

        out.push(new Word({
          case: Word.NOT_FOUND_IN_TRANSCRIPT(),
          phones,
          start: hypToken.start,
          duration: hypToken.duration,
          word
        }));
      }
      continue;
    }

    const displayWord = displaySeq[b];
    const [startOffset, endOffset] = txtOffsets[b];

    if (op === 'equal') {
      const hypWord = hypothesis[a];
      const hypToken = alignment[a];
      const phones = hypToken.phones || [];

      out.push(new Word({
        case: Word.SUCCESS(),
        startOffset,
        endOffset,
        word: displayWord,
        alignedWord: hypWord,
        phones,
        start: hypToken.start,
        duration: hypToken.duration
      }));
    } else if (['insert', 'replace'].includes(op)) {
      out.push(new Word({
        case: Word.NOT_FOUND_IN_AUDIO(),
        startOffset,
        endOffset,
        word: displayWord
      }));
    }
  }
  return out;
};

// Vary from python implementation to avoid generators
class WordDiff {
  constructor(a, b) {
    const matcher = new SequenceMatcher(null, a, b);
    this.iterator = byWord(matcher.getOpcodes());
  }

  next() {
    const result = this.iterator.next();
    const [op, aIdx, , bIdx] = result.value;
    result.value = [op, aIdx, bIdx];
    return result;
  }
}

const wordDiff = (a, b) => {
  // Like difflib.SequenceMatcher but it only compares one word
  // at a time. Returns an iterator whose elements are like
  // (operation, index in a, index in b)
  return new WordDiff(a, b);
};

class ByWord {
  constructor(opcodes) {
    this.opcodes = opcodes;
    this.index = 0;
    this.state = null;
  }

  next() {
    const opcode = this.opcodes[this.index];
    if (!opcode) {
      return { done: true };
    }
    const [op, s1, e1, s2, e2] = opcode;
    const result = { done: false };
    if (op === 'delete') {
      if (!this.state) {
        this.state = { i: s1 };
      }
      const { i } = this.state;
      if (i < e1) {
        result.value = [op, i, i + 1, s2, s2];
        this.state.i++;
        if (this.state.i >= e1) {
          this.index++;
          this.state = null;
        }
      }
    } else if (op === 'insert') {
      if (!this.state) {
        this.state = { i: s2 };
      }
      const { i } = this.state;
      if (i < e2) {
        result.value = [op, s1, s1, i, i + 1];
        this.state.i++;
        if (this.state.i >= e2) {
          this.index++;
          this.state = null;
        }
      }
    } else {
      const len1 = e1 - s1;
      const len2 = e2 - s2;
      if (!this.state) {
        this.state = {
          i1: s1,
          i2: s2,
          j1: e1,
          j2: e2,
        };
        if (len1 > len2) {
          this.state.j1 = s1 + len2;
        } else if (len2 > len1) {
          this.state.j2 = s2 + len1;
        }
      }
      const {
        i1, i2, j1, j2
      } = this.state;
      if (i1 < e1 && i2 < e2) {
        result.value = [op, i1, i1 + 1, i2, i2 + 1];
        this.state.i1++;
        this.state.i2++;
      } else if (j1 < e1) {
        result.value = ['delete', j1, j1 + 1, e2, e2];
        this.state.j1++;
      } else if (j2 < e2) {
        result.value = ['insert', s1, s1, j2, j2 + 1];
        this.state.j2++;
      }
      if ((this.state.i1 >= e1 || this.state.i2 >= e2)
          && this.state.j1 >= e1
          && this.state.j2 >= e2) {
        this.index++;
        this.state = null;
      }
    }
    if (this.index >= this.opcodes.length) {
      result.done = true;
    }
    return result;
  }
}

const byWord = opcodes => {
  // Take difflib.SequenceMatcher.get_opcodes() output and
  // return an equivalent opcode sequence that only modifies
  // one word at a time
  return new ByWord(opcodes);
};

module.exports = {
  align,
};
