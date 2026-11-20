const fs = require('node:fs');
const path = require('node:path');

module.exports = ({ config }) => {
  const googleServicesFile = './google-services.json';
  if (!fs.existsSync(path.join(__dirname, googleServicesFile))) return config;
  return { ...config, android: { ...config.android, googleServicesFile } };
};
