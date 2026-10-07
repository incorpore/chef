'use strict';
/**
 * Procura segredos vazados nos arquivos versionados E em todo o histórico do Git.
 * Uso: npm run audit:secrets   (rode antes de cada push; sai com código 1 se achar algo)
 */
const { execSync } = require('node:child_process');

const PATTERNS = [
  ['Chave privada', /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/],
  ['AWS Access Key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API Key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Stripe live key', /\b(sk|rk)_live_[0-9a-zA-Z]{20,}\b/],
  ['GitHub token', /\b(ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36}\b/],
  ['Slack token', /\bxox[abpr]-[0-9A-Za-z-]{20,}\b/],
  ['Chave de API do Chef', /\bchef_[A-Za-z0-9_-]{32}\b/],
  ['Senha em variável', /\b(PASSWORD|SENHA|SECRET|TOKEN|API_KEY)\s*[:=]\s*["'][^"'\s]{8,}["']/i],
  ['URL com senha', /\b[a-z]+:\/\/[^\s:/@]+:[^\s:/@]{6,}@[^\s]+/i],
];
const SENSITIVE_FILES = /(^|\/)\.env($|\.(?!example))|\.(db|sqlite3?|pem|key|p12|pfx)$|(^|\/)data\/|id_rsa|\.secret$/;
const IGNORE = /package-lock\.json$|\.(png|jpe?g|gif|webp|ico)$|^test\/|^scripts\/check-secrets\.js$/;

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

const problems = [];
const files = sh('git ls-files').split('\n').filter(Boolean);
for (const f of files) {
  if (SENSITIVE_FILES.test(f)) problems.push(`Arquivo sensível versionado: ${f}`);
  if (IGNORE.test(f)) continue;
  let content = '';
  try { content = require('node:fs').readFileSync(f, 'utf8'); } catch { continue; }
  for (const [name, re] of PATTERNS) if (re.test(content)) problems.push(`${name} em ${f}`);
}

// Histórico completo: um segredo apagado depois continua no Git!
let history = '';
try { history = sh('git log -p --all --no-color -- . ":(exclude)package-lock.json" ":(exclude)test/*" ":(exclude)scripts/check-secrets.js"'); } catch { /* sem git */ }
for (const [name, re] of PATTERNS) {
  const m = history.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`));
  if (m) problems.push(`${name} no histórico do Git (${m.length}x) — troque o segredo e limpe o histórico`);
}
const deleted = sh('git log --all --diff-filter=D --name-only --pretty=format:').split('\n').filter((f) => f && SENSITIVE_FILES.test(f));
for (const f of new Set(deleted)) problems.push(`Arquivo sensível já esteve no histórico: ${f}`);

if (problems.length) {
  console.error('❌ Possíveis segredos encontrados:\n' + [...new Set(problems)].map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log(`✅ Nenhum segredo encontrado em ${files.length} arquivos e no histórico do Git.`);
