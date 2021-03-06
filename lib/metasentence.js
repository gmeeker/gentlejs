// [oov] no longer in words.txt
const OOV_TERM = '<unk>';

const loadVocabulary = wordsFile => {
  // Load vocabulary words from an OpenFST SymbolTable formatted text file
  const result = {};
  wordsFile.forEach(x => {
    if (x) {
      result[x.split(' ')[0]] = true;
    }
  });
  return result;
};

const kaldiNormalize = (word, vocab) => {
  // Take a token extracted from a transcript by MetaSentence and
  // transform it to use the same format as Kaldi's vocabulary files.
  // Removes fancy punctuation and strips out-of-vocabulary words.

  // lowercase
  let norm = word.toLowerCase();
  // Turn fancy apostrophes into simpler apostrophes
  // eslint-disable-next-line quotes
  norm = norm.replace("’", "'");
  if (norm.length > 0 && !vocab[norm]) {
    norm = OOV_TERM;
  }
  return norm;
};

class MetaSentence {
  // Maintain two parallel representations of a sentence: one for
  // Kaldi's benefit, and the other in human-legible form.

  constructor(sentence, vocab) {
    this.rawSentence = sentence;

    if (typeof sentence !== 'string') {
      this.rawSentence = sentence.toString();
    }
    this.vocab = vocab;

    this.tokenize();
  }

  tokenize() {
    this.seq = [];
    let m;
    const myRe = /(\w|’\w|'\w)+/g;
    // eslint-disable-next-line no-cond-assign
    while ((m = myRe.exec(this.rawSentence)) !== null) {
      const [word] = m;
      const start = m.index;
      const end = start + word.length;
      const token = kaldiNormalize(word, this.vocab);
      this.seq.push({
        start, // as unicode codepoint offset
        end, // as unicode codepoint offset
        token,
      });
    }
  }

  getKaldiSequence() {
    return this.seq.map(x => x.token);
  }

  getDisplaySequence() {
    const displaySequence = [];
    this.seq.forEach(x => {
      const { start, end } = x;
      const word = this.rawSentence.substring(start, end);
      displaySequence.push(word);
    });
    return displaySequence;
  }

  getTextOffsets() {
    return this.seq.map(x => [x.start, x.end]);
  }
}

module.exports = {
  loadVocabulary,
  kaldiNormalize,
  MetaSentence,
};
