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
    this.proto_langdir = await getResource('exp');
    this.nnet_gpu_path = await getResource(path.join('exp', 'tdnn_7b_chain_online'));
    this.full_hclg_path = await getResource(path.join('exp', 'tdnn_7b_chain_online', 'graph_pp', 'HCLG.fst'));

    const requireDir = async dirpath => {
      return fs.stat(dirpath).then(stat => stat.isDir())
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
    this.vocab = await loadVocabulary(data.split(/\r\n|\r|\n/));
  }
}

module.exports = Resources;
