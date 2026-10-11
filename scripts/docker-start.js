'use strict';
/**
 * Ponto de entrada do container.
 * 1) Se estiver rodando como root, cria as pastas de dados e corrige o dono
 *    (no ZimaOS as pastas em /DATA/AppData são criadas pelo Docker como root).
 * 2) Troca para um usuário comum (PUID/PGID, padrão 1000) — o app nunca roda como root.
 * 3) Inicia o servidor.
 */
const fs = require('node:fs');
const path = require('node:path');

const PUID = Number(process.env.PUID || 1000);
const PGID = Number(process.env.PGID || 1000);
const dirs = [process.env.DATA_DIR || '/app/data', process.env.UPLOADS_DIR || '/app/uploads'];

function fixOwner(dir) {
  const stack = [dir];
  let changed = 0;
  while (stack.length) {
    const p = stack.pop();
    let st;
    try { st = fs.lstatSync(p); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    if (st.uid !== PUID || st.gid !== PGID) {
      try { fs.chownSync(p, PUID, PGID); changed++; } catch { /* sistema de arquivos sem suporte (ex.: SMB) */ }
    }
    if (st.isDirectory()) for (const f of fs.readdirSync(p)) stack.push(path.join(p, f));
  }
  return changed;
}

if (typeof process.getuid === 'function' && process.getuid() === 0) {
  for (const d of dirs) {
    fs.mkdirSync(d, { recursive: true });
    const n = fixOwner(d);
    if (n) console.log(`🔧 Permissões ajustadas em ${d} (${n} itens) para ${PUID}:${PGID}`);
  }
  try { fs.chmodSync(dirs[0], 0o700); } catch { /* ignore */ }
  if (PUID !== 0) {
    process.setgroups([]);
    process.setgid(PGID);
    process.setuid(PUID);
  } else {
    console.warn('⚠️  PUID=0: o Chef vai rodar como root (não recomendado).');
  }
}

require('../server.js');
