const fs = require('fs-extra');
const path = require('path');
const { ENV_VAR, getResource } = require('./util');
const { loadVocabulary } = require('./metasentence');

class Resources {
  constructor() {
    this.protoLangDir = null;
    this.nnetGpuPath = null;
    this.fullHclgPath = null;
  }

  async init() {
    this.protoLangDir = await getResource('exp');
    this.nnetGpuPath = await getResource(path.join('exp', 'tdnn_7b_chain_online'));
    this.fullHclgPath = await getResource(path.join('exp', 'tdnn_7b_chain_online', 'graph_pp', 'HCLG.fst'));

    const requireDir = async dirpath => {
      return fs.stat(dirpath).then(stat => stat.isDirectory())
        .catch(() => false)
        .then(isdir => {
          if (!isdir) {
            throw new Error(`No resource directory ${dirpath}.  Check ${ENV_VAR} environment variable?`);
          }
        });
    };

    await requireDir(this.protoLangDir);
    await requireDir(this.nnetGpuPath);

    const data = await fs.readFile(path.join(this.protoLangDir, 'langdir', 'words.txt'));
    this.vocab = await loadVocabulary(data.toString().split(/\r\n|\r|\n/));
  }
}

module.exports = Resources;
