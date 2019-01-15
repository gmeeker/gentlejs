const fs = require('fs-extra');
const path = require('path');

const ENV_VAR = 'GENTLE_RESOURCES_ROOT';

const getProjectRoot = () => {
  const root = process.env.ENV_VAR;
  if (!root) {
    throw new Error(`${ENV_VAR} is not set!`);
  }
  return root;
};

const getBinary = async name => {
  const pathInProject = path.join(getProjectRoot(), name);
  return fs.stat(pathInProject).then(() => pathInProject)
    .catch(() => name);
};

const getResource = async name => {
  const root = getProjectRoot();
  return path.join(root, name);
};

const getDataDir = async name => {
  return getResource(name);
};

module.exports = {
  ENV_VAR,
  getBinary,
  getResource,
  getDataDir,
};
