const fs = require('fs-extra');
const { spawn } = require('child_process');
const tmp = require('tmp');
const { isArray, keys } = require('lodash');
const { getBinary } = require('./util');

// [oov] no longer in words.txt
const OOV_TERM = '<unk>';

class MySet {
  constructor(set = []) {
    this.set = {};
    set.forEach(s => {
      this.set[s] = true;
    });
  }

  add(v) {
    this.set[v] = true;
  }

  update(set) {
    set.forEach(s => {
      this.set[s] = true;
    });
  }
}

const setdefault = (obj, key) => {
  if (!obj[key]) {
    obj.key = new MySet();
  }
  return obj.key;
};

const makeBigramLmFst = (wordSequencesIn, options = {}) => {
  // Use the given token sequence to make a bigram language model
  // in OpenFST plain text format.

  // When the "conservative" flag is set, an [oov] is interleaved
  // between successive words.

  // When the "disfluency" flag is set, a small set of disfluencies is
  // interleaved between successive words

  // `Word sequence` is a list of lists, each valid as a start

  let wordSequences = wordSequencesIn;
  if (wordSequences.length === 0 || !isArray(wordSequences[0])) {
    wordSequences = [wordSequences];
  }

  const conservative = options.conservative || false;
  const disfluency = options.disfluency || false;
  const disfluencies = options.disfluencies || [];

  const bigrams = { OOV_TERM: new MySet([OOV_TERM]) };

  wordSequences.forEach(wordSequence => {
    if (wordSequence.length === 0) {
      return;
    }

    let prevWord = wordSequence[0];
    bigrams[OOV_TERM].add(prevWord); // valid start (?)

    if (disfluency) {
      bigrams[OOV_TERM].update(disfluencies);

      disfluencies.forEach(dis => {
        setdefault(bigrams, dis).add(prevWord);
        bigrams[dis].add(OOV_TERM);
      });
    }

    wordSequence.slice(1).forEach(word => {
      setdefault(bigrams, prevWord).add(word);

      if (conservative) {
        bigrams[prevWord].add(OOV_TERM);
      }

      if (disfluency) {
        bigrams[prevWord].update(disfluencies);
      }

      disfluencies.forEach(dis => {
        bigrams[dis].add(word);
      });

      prevWord = word;
    });

    // ...valid end
    setdefault(bigrams, prevWord).add(OOV_TERM);
  });

  const nodeIds = {};
  function getNodeId(word) {
    const nodeId = nodeIds.get(word, nodeIds.length + 1);
    nodeIds[word] = nodeId;
    return nodeId;
  }

  let output = '';
  keys(bigrams).sort().forEach(fromWord => {
    const fromId = getNodeId(fromWord);

    const successors = bigrams[fromWord];
    let weight;
    if (successors.length > 0) {
      weight = -Math.log(1.0 / successors.length);
    } else {
      weight = 0;
    }

    successors.sort().forEach(toWord => {
      const toId = getNodeId(toWord);
      output += `${fromId}    ${toId}    ${toWord}    ${toWord}    ${weight}`;
      output += '\n';
    });
  });

  output += `${nodeIds.length}    0\n`;

  return output;
};

const makeBigramLanguageModel = (kaldiSeq, protoLangdir, options = {}) => {
  // Generates a language model to fit the text.

  // Returns the filename of the generated language model FST.
  // The caller is resposible for removing the generated file.

  // `proto_langdir` is a path to a directory containing prototype model data
  // `kaldi_seq` is a list of words within kaldi's vocabulary.

  const MKGRAPH_PATH = getBinary('m3');

  // Generate a textual FST
  const txtFst = makeBigramLmFst(kaldiSeq, options);
  const txtFstFile = tmp.tmpNameSync();
  return fs.writeFile(txtFstFile, txtFst)
    .then(() => {
      const hclgFilename = tmp.tmpNameSync() + '_HCLG.fst';
      const args = [protoLangdir, txtFstFile, hclgFilename];
      const p = spawn(MKGRAPH_PATH, args, { stdio: 'ignore' });
      return new Promise((resolve, reject) => {
        p.on('exit', code => {
          if (code) {
            reject(new Error(`m3 failed with ${code}`));
          } else {
            resolve();
          }
        });
      }).catch(err => {
        fs.unlink(txtFstFile);
        throw err;
      }).then(() => {
        fs.unlink(txtFstFile);

        return hclgFilename;
      });
    });
};

module.exports = {
  makeBigramLmFst,
  makeBigramLanguageModel,
};
