const { keys, isEqual } = require('lodash');
const stringify = require('json-stable-stringify');

class Word {
  static SUCCESS() { return 'success'; }

  static NOT_FOUND_IN_AUDIO() { 'not-found-in-audio'; }

  static NOT_FOUND_IN_TRANSCRIPT() { 'not-found-in-transcript'; }

  /*
   * dict: case, startOffset, endOffset, word, alignedWord, phones, start, end, duration
   */
  constructor(dict = {}) {
    this.dict = dict;
    const { start, end, duration } = dict;
    if (start !== undefined) {
      if (end === undefined) {
        this.end = start + duration;
      } else if (duration === undefined) {
        this.duration = end - start;
      }
    }
  }

  success() {
    return this.dict.case === Word.SUCCESS;
  }

  notFoundInAudio() {
    return this.dict.case === Word.NOT_FOUND_IN_AUDIO;
  }

  asDict(without) {
    const result = {};
    keys(this.dict).forEach(key => {
      if (this.dict[key] !== undefined && key !== without) {
        result[key] = this.dict[key];
      }
    });
    return result;
  }

  isEqual(other) {
    return isEqual(this.dict, other.dict);
  }

  notIsEqual(other) {
    return !this.isEqual(this, other);
  }

  toString() {
    const d = this.asDict('phones');
    return 'Word(' + d.forEach(key => `${key}=${d[key]}`).join(' ') + ')';
  }

  shift(options = {}) {
    const { time, offset } = options;
    if (this.dict.start !== undefined && time !== undefined) {
      this.dict.start += time;
      this.dict.end += time;
    }

    if (this.dict.startOffset !== undefined && offset !== undefined) {
      this.dict.startOffset += offset;
      this.dict.endOffset += offset;
    }
    return this; // for easy chaining
  }

  swapAlignment(other) {
    // Swaps the alignment info of two words, but does not swap the offset
    const tmp = {
      case: this.dict.case,
      alignedWord: this.dict.alignedWord,
      phones: this.dict.phones,
      start: this.dict.start,
      end: this.dict.end,
      duration: this.dict.duration,
    };
    this.dict = {
      case: other.dict.case,
      alignedWord: other.dict.alignedWord,
      phones: other.dict.phones,
      start: other.dict.start,
      end: other.dict.end,
      duration: other.dict.duration,
    };
    const o = other;
    o.dict = tmp;
  }

  corresponds(other) {
    // Returns true if this and other refer to the same word, at the same position in the audio (within a small tolerance)
    if (this.dict.word !== other.dict.word) {
      return false;
    }
    return Math.abs(this.dict.start - other.dict.start) / (this.dict.duration + other.dict.duration) < 0.1;
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
