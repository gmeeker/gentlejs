const fs = require('fs-extra');
const path = require('path');
const process = require('process');
const tmp = require('tmp');

const ENV_VAR = 'GENTLE_RESOURCES_ROOT';

const getProjectRoot = (required = true) => {
  const root = process.env[ENV_VAR];
  if (!root && required) {
    throw new Error(`${ENV_VAR} is not set!`);
  }
  return root;
};

const getBinary = async (name, rootIn, ext = false) => {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const filename = name + suffix;
  const root1 = rootIn || getProjectRoot(ext);
  if (!root1) {
    return filename;
  }
  const root = ext ? path.join(root1, 'ext') : root1;
  const pathInProject = path.join(root, filename);
  return fs.stat(pathInProject).then(() => pathInProject)
    .catch(() => filename);
};

const getResource = async (name, root) => {
  return path.join(root || getProjectRoot(), name);
};

const getDataDir = async (name, root) => {
  return getResource(name, root);
};

const tmpName = () => {
  return new Promise((resolve, reject) => {
    tmp.tmpName((err, name) => {
      if (err) {
        reject(err);
      } else {
        resolve(name);
      }
    });
  });
};

module.exports = {
  ENV_VAR,
  getBinary,
  getResource,
  getDataDir,
  tmpName,
};
