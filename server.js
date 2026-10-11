'use strict';
const config = require('./src/config');
const db = require('./src/db');
const auth = require('./src/auth');
const { createApp } = require('./src/app');

db.open();
const boot = auth.bootstrapAdmin();
if (boot === 'env') console.log('👤 Administrador criado a partir de ADMIN_EMAIL/ADMIN_PASSWORD.');
if (boot === 'token') {
  if (auth.isPlaceholderToken()) console.warn('⛔ SETUP_TOKEN ainda está com o valor de exemplo. Troque-o no docker-compose e reinicie o app antes de criar o administrador.');
  else if (process.env.SETUP_TOKEN) console.log('🔐 Primeiro acesso: abra /admin e digite o SETUP_TOKEN que você definiu.');
  else console.log(`🔐 Primeiro acesso: abra /admin/setup e use o token de instalação: ${auth.setupToken()}`);
}
if (!process.env.SESSION_SECRET) console.log(`🔑 Segredo de sessão gerado e guardado em ${config.dataDir}/.secret (não apague esse arquivo).`);
if (config.isProd && !config.baseUrl) console.log('ℹ️  BASE_URL não definida: o endereço é detectado pelo navegador. Ao publicar com domínio próprio, defina BASE_URL=https://seusite.com.br');

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`🍳 Chef rodando na porta ${config.port} (dados em ${config.dataDir}, fotos em ${config.uploadsDir})`);
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
