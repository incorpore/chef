'use strict';
const config = require('./src/config');
const db = require('./src/db');
const { createApp } = require('./src/app');

db.open();
const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`🍳 Chef rodando em http://localhost:${config.port}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
