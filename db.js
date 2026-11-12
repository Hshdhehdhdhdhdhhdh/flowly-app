// Tiny JSON-file database. Fine for a demo/assignment; swap for Postgres/MongoDB in production.
const fs = require('fs');
const path = require('path');

const FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'db.json');
const EMPTY = { users: [], tasks: [], demoRequests: [] };

function load() {
  try { return { ...EMPTY, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; }
  catch { return structuredClone(EMPTY); }
}

let data = load();

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE); // atomic replace
}

module.exports = {
  get: (key) => data[key],
  update: (key, fn) => { data[key] = fn(data[key]); save(); },
};
