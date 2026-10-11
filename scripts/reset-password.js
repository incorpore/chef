'use strict';
/**
 * Redefine a senha de um usuário (ex.: esqueceu a senha do admin).
 * Uso no ZimaOS:
 *   sudo docker exec -it -u 1000:1000 chef node scripts/reset-password.js email@exemplo.com
 * A nova senha é pedida no terminal (não fica no histórico). Também derruba as sessões antigas.
 */
const readline = require('node:readline');
const db = require('../src/db');
const auth = require('../src/auth');

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email) {
  console.error('Uso: node scripts/reset-password.js email@exemplo.com');
  process.exit(1);
}
db.open();
const user = db.get().prepare('SELECT * FROM users WHERE email = ?').get(email);
if (!user) {
  const list = db.get().prepare('SELECT email, role FROM users').all();
  console.error(`Usuário não encontrado. Usuários existentes:\n${list.map((u) => `  - ${u.email} (${u.role})`).join('\n') || '  (nenhum)'}`);
  process.exit(1);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); }; // esconde o que é digitado
    rl.question(question, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

(async () => {
  const password = process.env.NEW_PASSWORD || await ask('Nova senha: ');
  const err = auth.validatePassword(password);
  if (err) { console.error(`❌ ${err}`); process.exit(1); }
  if (!process.env.NEW_PASSWORD && (await ask('Repita a nova senha: ')) !== password) { console.error('❌ As senhas não conferem'); process.exit(1); }
  db.get().prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?').run(auth.hashPassword(password), user.id);
  auth.audit(null, 'password.reset-cli', email);
  console.log(`✅ Senha de ${email} redefinida. Faça login novamente.`);
  db.close();
})();
