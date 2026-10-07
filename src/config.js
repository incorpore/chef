'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const uploadsDir = path.resolve(process.env.UPLOADS_DIR || path.join(root, 'uploads'));
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

// Segredo para assinar sessões. Se não for definido, um é gerado e salvo em data/.
function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(dataDir, '.secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const s = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, s, { mode: 0o600 });
    return s;
  }
}

module.exports = {
  root,
  dataDir,
  uploadsDir,
  port: Number(process.env.PORT) || 3000,
  dbFile: process.env.DB_FILE || path.join(dataDir, 'chef.db'),
  secret: loadSecret(),
  baseUrl: (process.env.BASE_URL || '').replace(/\/$/, ''),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB) || 200,
  isProd: process.env.NODE_ENV === 'production',
};
