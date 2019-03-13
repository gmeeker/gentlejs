const fs = require('fs-extra');
const path = require('path');

const ENV_VAR = 'GENTLE_RESOURCES_ROOT';

const getProjectRoot = () => {
  const root = process.env[ENV_VAR];
  if (!root) {
    throw new Error(`${ENV_VAR} is not set!`);
  }
  return root;
};

const getBinary = async (name, rootIn, ext = true) => {
  const root1 = rootIn || getProjectRoot();
  const root = ext ? path.join(root1, 'ext') : root1;
  const pathInProject = path.join(root, name);
  return fs.stat(pathInProject).then(() => pathInProject)
    .catch(() => name);
};

const getResource = async (name, root) => {
  return path.join(root || getProjectRoot(), name);
};

const getDataDir = async (name, root) => {
  return getResource(name, root);
};

module.exports = {
  ENV_VAR,
  getBinary,
  getResource,
  getDataDir,
};
