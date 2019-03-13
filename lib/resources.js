const fs = require('fs-extra');
const path = require('path');
const {
  ENV_VAR, getBinary, getResource, getDataDir,
} = require('./util');
const { loadVocabulary } = require('./metasentence');

class Resources {
  constructor(paths = {}) {
    this.protoLangDir = null;
    this.nnetGpuPath = null;
    this.fullHclgPath = null;
    this.paths = paths;
  }

  async getBinary(name) {
    const root = this.paths.binaries || this.paths.projectRoot;
    return getBinary(name, root, !this.paths.binaries);
  }

  async getResource(name) {
    return getResource(name, this.paths.resources || this.paths.projectRoot);
  }

  async getDataDir(name) {
    return getDataDir(name, this.paths.data || this.paths.projectRoot);
  }

  async init() {
    this.protoLangDir = await this.getResource('exp');
    this.nnetGpuPath = await this.getResource(path.join('exp', 'tdnn_7b_chain_online'));
    this.fullHclgPath = await this.getResource(path.join('exp', 'tdnn_7b_chain_online', 'graph_pp', 'HCLG.fst'));

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
