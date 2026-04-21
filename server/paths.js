const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const SPREADSHEET_ID_FILE = path.join(DATA_DIR, 'spreadsheet-id.txt');

module.exports = { ROOT, DATA_DIR, SPREADSHEET_ID_FILE };
