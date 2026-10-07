'use strict';
const config = require('./src/config');
const db = require('./src/db');
const auth = require('./src/auth');
const { createApp } = require('./src/app');

db.open();
const boot = auth.bootstrapAdmin();
if (boot === 'env') console.log('👤 Administrador criado a partir de ADMIN_EMAIL/ADMIN_PASSWORD.');
if (boot === 'token') console.log(`🔐 Primeiro acesso: abra /admin/setup e use o token de instalação: ${auth.setupToken()}`);
if (config.isProd && !process.env.SESSION_SECRET) console.warn('⚠️  Defina SESSION_SECRET no ambiente em produção.');
if (config.isProd && !config.baseUrl) console.warn('⚠️  Defina BASE_URL (ex.: https://seusite.com.br) para canonical, sitemap e compartilhamento corretos.');

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`🍳 Chef rodando em http://localhost:${config.port}`);
});
server.headersTimeout = 30000;
server.requestTimeout = 120000;

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
