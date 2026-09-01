const fs = require('node:fs');
const path = require('node:path');

module.exports = function loadAppSource() {
  const root = path.resolve(__dirname, '..');
  return ['index.html', 'styles.css', 'app.js']
    .filter((file) => fs.existsSync(path.join(root, file)))
    .map((file) => fs.readFileSync(path.join(root, file), 'utf8'))
    .join('\n');
};
