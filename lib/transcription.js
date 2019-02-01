const { keys, isEqual } = require('lodash');
const stringify = require('json-stable-stringify');

const wordKeys = [
  'case',
  'startOffset',
  'endOffset',
  'word',
  'alignedWord',
  'phones',
  'start',
  'end',
  'duration',
];

class Word {
  static SUCCESS() { return 'success'; }

  static NOT_FOUND_IN_AUDIO() { 'not-found-in-audio'; }

  static NOT_FOUND_IN_TRANSCRIPT() { 'not-found-in-transcript'; }

  /*
   * dict: case, startOffset, endOffset, word, alignedWord, phones, start, end, duration
   */
  constructor(dict = {}) {
    wordKeys.forEach(key => {
      this[key] = dict[key];
    });
    const { start, end, duration } = this;
    if (start !== undefined) {
      if (end === undefined) {
        this.end = start + duration;
      } else if (duration === undefined) {
        this.duration = end - start;
      }
    }
  }

  success() {
    return this.case === Word.SUCCESS();
  }

  notFoundInAudio() {
    return this.case === Word.NOT_FOUND_IN_AUDIO();
  }

  asDict(without) {
    const result = {};
    wordKeys.forEach(key => {
      if (this[key] !== undefined && key !== without) {
        result[key] = this[key];
      }
    });
    return result;
  }

  isEqual(other) {
    for (let i = 0; i < wordKeys.length; i++) {
      const key = wordKeys[i];
      if (!isEqual(this[key], other[key])) {
        return false;
      }
    }
    return true;
  }

  notIsEqual(other) {
    return !this.isEqual(this, other);
  }

  toString() {
    const d = this.asDict('phones');
    return 'Word(' + keys(d).sort().forEach(key => `${key}=${d[key]}`).join(' ') + ')';
  }

  shift(options = {}) {
    const { time, offset } = options;
    if (this.start !== undefined && time !== undefined) {
      this.start += time;
      this.end += time;
    }

    if (this.startOffset !== undefined && offset !== undefined) {
      this.startOffset += offset;
      this.endOffset += offset;
    }
    return this; // for easy chaining
  }

  swapAlignment(other) {
    // Swaps the alignment info of two words, but does not swap the offset
    [
      'case',
      'alignedWord',
      'phones',
      'start',
      'end',
      'duration',
    ].forEach(key => {
      const v = this[key];
      this[key] = other[key];
      other[key] = v;
    });
  }

  corresponds(other) {
    // Returns true if this and other refer to the same word, at the same position in the audio (within a small tolerance)
    if (this.word !== other.word) {
      return false;
    }
    return Math.abs(this.start - other.start) / (this.duration + other.duration) < 0.1;
  }
}

class Transcription {
  constructor(transcript, words) {
    this.transcript = transcript;
    this.words = words;
  }

  isEqual(other) {
    return isEqual(this.transcript, other.transcript) && isEqual(this.words, other.words);
  }

  toJSON() {
    // Return a JSON representation of the aligned transcript
    const container = {};
    if (this.transcript) {
      container.transcript = this.transcript;
    }
    if (this.words) {
      container.words = this.words.map(word => word.asDict('duration'));
    }
    return stringify(container, { space: 4 });
  }

  toCSV() {
    // Return a CSV representation of the aligned transcript. Format:
    // <word> <token> <start seconds> <end seconds>
    if (!this.words) {
      return '';
    }
    let result = '';
    this.words.forEach(X => {
      if ([Word.SUCCESS(), Word.NOT_FOUND_IN_AUDIO()].includes(X.case)) {
        const {
          word,
          alignedWord,
          start,
          end,
        } = X;
        result += `${word}\t${alignedWord}\t${start}\t${end}\n`;
      }
    });
    return result;
  }

  stats() {
    const counts = {};
    this.words.forEach(word => {
      counts[word.case] = (counts[word.case] || 0) + 1;
    });
    counts.total = this.words.length;
    return counts;
  }
}

module.exports = {
  Transcription,
  Word,
};
