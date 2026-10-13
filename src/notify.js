'use strict';
/** Fluxos de e-mail: senha, convites, avisos de comentário e newsletter. */
const crypto = require('node:crypto');
const db = require('./db');
const mail = require('./mail');
const settings = require('./settings');
const config = require('./config');
const { esc, formatMinutes } = require('./util');

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const isoIn = (ms) => new Date(Date.now() + ms).toISOString();
const abs = (path) => `${mail.siteUrl()}${path}`;
const recipeImage = (r) => (r.cover ? (r.cover.startsWith('/') ? abs(r.cover) : r.cover) : '');

/** Dispara um e-mail sem travar a resposta ao visitante (erros vão só para o log). */
function background(label, fn) {
  if (!mail.isConfigured()) return;
  Promise.resolve().then(fn).catch((e) => console.error(`[mail] ${label}:`, e.message, e.cause?.message || ''));
}

// ---------------------------------------------------------------------------
// Senha: "esqueci minha senha" e convite de novo usuário
// ---------------------------------------------------------------------------
function createResetToken(userId, purpose = 'reset', ttlMs = 60 * 60e3) {
  const token = newToken();
  const d = db.get();
  d.prepare("DELETE FROM password_resets WHERE user_id = ? AND (used_at IS NOT NULL OR expires_at < ?)").run(userId, new Date().toISOString());
  d.prepare('INSERT INTO password_resets (user_id, token_hash, purpose, expires_at) VALUES (?, ?, ?, ?)').run(userId, sha256(token), purpose, isoIn(ttlMs));
  return token;
}

/** Valida o token (sem consumir). */
function findResetToken(token) {
  if (!token || String(token).length > 100) return null;
  const row = db.get().prepare('SELECT r.*, u.email, u.name FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ?').get(sha256(token));
  if (!row || row.used_at || row.expires_at < new Date().toISOString()) return null;
  return row;
}

/** Consome o token: só pode ser usado uma vez; os outros links pendentes do usuário são invalidados. */
function consumeResetToken(token) {
  const row = findResetToken(token);
  if (!row) return null;
  const d = db.get();
  d.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").run(row.user_id);
  return row;
}

async function sendPasswordReset(user) {
  const token = createResetToken(user.id, 'reset', 60 * 60e3);
  const link = abs(`/admin/redefinir?t=${encodeURIComponent(token)}`);
  const s = settings.all();
  await mail.send({
    to: user.email,
    subject: `Redefinir sua senha — ${s.siteName}`,
    text: `Olá, ${user.name}!\n\nRecebemos um pedido para redefinir a senha da sua conta no ${s.siteName}.\nCrie uma nova senha neste link (válido por 1 hora, uso único):\n${link}\n\nSe não foi você, ignore este e-mail: sua senha continua a mesma.`,
    html: mail.layout({
      title: 'Redefinir senha',
      preheader: 'Link válido por 1 hora',
      body: `<h1 style="font-size:22px;margin:0 0 12px">Redefinir sua senha</h1>
        <p>Olá, ${esc(user.name)}! Recebemos um pedido para redefinir a senha da sua conta.</p>
        ${mail.button(link, 'Criar nova senha')}
        <p style="color:#5d554d;font-size:14px">O link vale por <b>1 hora</b> e só pode ser usado uma vez.<br>Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>`,
    }),
  });
}

async function sendInvite(user, invitedBy) {
  const token = createResetToken(user.id, 'invite', 72 * 60 * 60e3);
  const link = abs(`/admin/redefinir?t=${encodeURIComponent(token)}&convite=1`);
  const s = settings.all();
  const role = user.role === 'admin' ? 'administrador(a)' : 'autor(a)';
  await mail.send({
    to: user.email,
    subject: `Você foi convidado(a) para o ${s.siteName}`,
    text: `Olá, ${user.name}!\n\n${invitedBy || 'A equipe'} convidou você para participar do ${s.siteName} como ${role}.\nCrie sua senha neste link (válido por 3 dias):\n${link}`,
    html: mail.layout({
      title: 'Convite',
      preheader: `Convite para o ${s.siteName}`,
      body: `<h1 style="font-size:22px;margin:0 0 12px">Bem-vindo(a) à cozinha! 👩‍🍳</h1>
        <p>Olá, ${esc(user.name)}! <b>${esc(invitedBy || 'A equipe')}</b> convidou você para participar do <b>${esc(s.siteName)}</b> como ${role}.</p>
        ${mail.button(link, 'Criar minha senha')}
        <p style="color:#5d554d;font-size:14px">O link vale por 3 dias. Depois disso, peça um novo convite ou use “Esqueci minha senha”.</p>`,
    }),
  });
}

/**
 * Aviso de segurança: e-mail ou senha da conta foram alterados.
 * Na troca de e-mail, o aviso vai para o endereço ANTIGO (se não foi você, dá para reagir).
 * Nunca falha a requisição: se o e-mail não estiver configurado, simplesmente não envia.
 */
function notifyAccountChange(to, user, what) {
  if (!mail.isConfigured() || !to) return;
  const s = settings.all();
  const label = what === 'email' ? 'o e-mail de acesso' : 'a senha';
  const extra = what === 'email' ? `\nNovo e-mail: ${user.email}` : '';
  const url = mail.siteUrl();
  mail.send({
    to,
    subject: `Sua conta no ${s.siteName} foi alterada`,
    text: `Olá, ${user.name}!\n\n${label[0].toUpperCase()}${label.slice(1)} da sua conta foi alterado agora.${extra}\n\nSe não foi você, use "Esqueci minha senha"${url ? ` em ${url}/admin/esqueci` : ''} e fale com o administrador.`,
    html: mail.layout({
      title: 'Conta alterada',
      preheader: `Alteramos ${label} da sua conta`,
      body: `<h1 style="font-size:22px;margin:0 0 12px">Sua conta foi alterada 🔐</h1>
        <p>Olá, ${esc(user.name)}! ${esc(label[0].toUpperCase() + label.slice(1))} da sua conta no <b>${esc(s.siteName)}</b> foi alterado agora.</p>
        ${what === 'email' ? `<p>Novo e-mail: <b>${esc(user.email)}</b></p>` : ''}
        <p style="color:#5d554d;font-size:14px">Se não foi você, redefina a senha imediatamente e avise o administrador do site.</p>
        ${url ? mail.button(`${url}/admin/esqueci`, 'Redefinir minha senha') : ''}`,
    }),
  }).catch((e) => console.error('[mail] aviso de conta alterada não enviado:', e.message));
}

// ---------------------------------------------------------------------------
// Aviso de comentário novo (autor da receita + administradores)
// ---------------------------------------------------------------------------
function notifyComment(recipe, comment) {
  if (!settings.all().notifyComments) return;
  background('aviso de comentário', async () => {
    const to = new Set(mail.adminEmails());
    if (recipe.author_id) {
      const a = db.get().prepare('SELECT email FROM users WHERE id = ?').get(recipe.author_id);
      if (a) to.add(a.email);
    }
    if (!to.size) return;
    const pending = comment.status === 'pending';
    const stars = comment.rating ? `${'★'.repeat(comment.rating)}${'☆'.repeat(5 - comment.rating)}` : '';
    await mail.send({
      to: [...to].join(', '),
      subject: `${pending ? 'Comentário aguardando aprovação' : 'Novo comentário'} em “${recipe.title}”`,
      text: `${comment.name} comentou em "${recipe.title}"${stars ? ` (${stars})` : ''}:\n\n${comment.body || '(sem texto)'}\n\n${pending ? 'Aprove ou recuse em: ' : 'Veja em: '}${abs('/admin/comentarios')}`,
      html: mail.layout({
        title: 'Novo comentário',
        preheader: `${comment.name}: ${String(comment.body || '').slice(0, 80)}`,
        body: `<h1 style="font-size:20px;margin:0 0 12px">${pending ? '💬 Comentário aguardando aprovação' : '💬 Novo comentário'}</h1>
          <p><b>${esc(comment.name)}</b> comentou em <a href="${esc(abs(`/receita/${recipe.slug}`))}" style="color:inherit">${esc(recipe.title)}</a>${stars ? ` <span style="color:#f5a524">${stars}</span>` : ''}</p>
          <div style="background:#faf6f1;border-left:4px solid #eadfd3;padding:12px 14px;border-radius:8px">${comment.body ? mail.paragraphs(comment.body) : '<i>(apenas avaliação)</i>'}</div>
          ${mail.button(abs('/admin/comentarios'), pending ? 'Aprovar ou recusar' : 'Ver comentários')}`,
      }),
    });
  });
}

// ---------------------------------------------------------------------------
// Newsletter: confirmação dupla, boas-vindas e descadastro
// ---------------------------------------------------------------------------
/** Token de descadastro estável por e-mail (HMAC), para o link em todo envio. */
function unsubscribeToken(email) {
  return crypto.createHmac('sha256', config.secret).update(`unsub:${String(email).toLowerCase()}`).digest('base64url').slice(0, 32);
}
function checkUnsubscribeToken(email, token) {
  const a = Buffer.from(unsubscribeToken(email));
  const b = Buffer.from(String(token || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function unsubscribeUrl(email) {
  return abs(`/newsletter/sair?e=${encodeURIComponent(email)}&t=${unsubscribeToken(email)}`);
}
function listHeaders(email) {
  const url = unsubscribeUrl(email);
  // RFC 8058: o Gmail/Yahoo mostram o botão "Cancelar inscrição" e enviam POST em um clique
  return { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}
function newsletterFooter(email) {
  const s = settings.all();
  return `Você recebe este e-mail porque se inscreveu em ${esc(s.siteName)}.<br><a href="${esc(unsubscribeUrl(email))}" style="color:#8f857b">Cancelar inscrição</a>`;
}

/**
 * Inscreve um e-mail. Com e-mail configurado e confirmação dupla ligada, fica "pendente" até clicar no link.
 * Retorna { status } — a resposta ao visitante é sempre a mesma (não revela quem já está inscrito).
 */
function subscribe(email) {
  const d = db.get();
  const s = settings.all();
  const doubleOptIn = s.newsletterDoubleOptIn && mail.isConfigured() && !!mail.siteUrl();
  const cur = d.prepare('SELECT * FROM subscribers WHERE email = ?').get(email);
  if (cur && cur.status === 'confirmed') return { status: 'confirmed' };
  if (!doubleOptIn) {
    if (cur) d.prepare("UPDATE subscribers SET status = 'confirmed', confirmed_at = datetime('now'), unsubscribed_at = NULL WHERE id = ?").run(cur.id);
    else d.prepare("INSERT INTO subscribers (email, status, confirmed_at) VALUES (?, 'confirmed', datetime('now'))").run(email);
    background('boas-vindas', () => sendWelcome(email));
    return { status: 'confirmed' };
  }
  // Evita usar o formulário para bombardear a caixa de alguém: no máximo 1 e-mail de confirmação a cada 10 min
  if (cur && cur.status === 'pending' && cur.token_expires && Date.parse(cur.token_expires) - 7 * 86400e3 + 10 * 60e3 > Date.now()) return { status: 'pending' };
  const token = newToken();
  if (cur) d.prepare("UPDATE subscribers SET status = 'pending', token_hash = ?, token_expires = ?, unsubscribed_at = NULL WHERE id = ?").run(sha256(token), isoIn(7 * 86400e3), cur.id);
  else d.prepare("INSERT INTO subscribers (email, status, token_hash, token_expires) VALUES (?, 'pending', ?, ?)").run(email, sha256(token), isoIn(7 * 86400e3));
  background('confirmação de inscrição', () => {
    const link = abs(`/newsletter/confirmar?t=${encodeURIComponent(token)}`);
    return mail.send({
      to: email,
      subject: `Confirme sua inscrição — ${s.siteName}`,
      text: `Falta pouco! Confirme sua inscrição para receber as receitas novas do ${s.siteName}:\n${link}\n\nSe você não pediu isso, ignore este e-mail.`,
      html: mail.layout({
        title: 'Confirme sua inscrição',
        preheader: 'Falta só um clique',
        body: `<h1 style="font-size:22px;margin:0 0 12px">Falta só um clique! 💌</h1>
          <p>Confirme que quer receber as receitas novas do <b>${esc(s.siteName)}</b>.</p>
          ${mail.button(link, 'Confirmar inscrição')}
          <p style="color:#5d554d;font-size:14px">Se você não pediu isso, ignore este e-mail — sem confirmação, nada será enviado.</p>`,
      }),
    });
  });
  return { status: 'pending' };
}

function confirmSubscription(token) {
  if (!token || String(token).length > 100) return null;
  const d = db.get();
  const row = d.prepare("SELECT * FROM subscribers WHERE token_hash = ? AND status = 'pending'").get(sha256(token));
  if (!row || (row.token_expires && row.token_expires < new Date().toISOString())) return null;
  d.prepare("UPDATE subscribers SET status = 'confirmed', confirmed_at = datetime('now'), token_hash = '', token_expires = NULL WHERE id = ?").run(row.id);
  background('boas-vindas', () => sendWelcome(row.email));
  return row;
}

function unsubscribe(email, token) {
  if (!email || !checkUnsubscribeToken(email, token)) return false;
  db.get().prepare("UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = datetime('now'), token_hash = '' WHERE email = ?").run(String(email).toLowerCase());
  return true;
}

function latestRecipes(n = 3) {
  return db.get().prepare("SELECT slug, title, description, cover, prep_minutes + cook_minutes + rest_minutes AS total FROM recipes WHERE status = 'published' ORDER BY COALESCE(published_at, created_at) DESC LIMIT ?").all(n);
}

function recipeBlock(r) {
  const img = recipeImage(r);
  const url = abs(`/receita/${r.slug}`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border:1px solid #eadfd3;border-radius:12px;overflow:hidden">
    ${img ? `<tr><td><a href="${esc(url)}"><img src="${esc(img)}" alt="" width="510" style="display:block;width:100%;height:auto;max-height:280px;object-fit:cover"></a></td></tr>` : ''}
    <tr><td style="padding:12px 14px"><a href="${esc(url)}" style="color:#1d1a17;text-decoration:none;font-size:18px;font-weight:bold">${esc(r.title)}</a>
    ${r.description ? `<p style="margin:6px 0 0;color:#5d554d;font-size:14px">${esc(r.description)}</p>` : ''}
    ${r.total ? `<p style="margin:6px 0 0;color:#8f857b;font-size:13px">⏱ ${esc(formatMinutes(r.total))}</p>` : ''}</td></tr></table>`;
}

async function sendWelcome(email) {
  const s = settings.all();
  if (!s.newsletterWelcome) return;
  const recent = latestRecipes(3);
  await mail.send({
    to: email,
    subject: `Bem-vindo(a) ao ${s.siteName}! 🍳`,
    headers: listHeaders(email),
    text: `Inscrição confirmada! Você vai receber as receitas novas do ${s.siteName}.\n\n${recent.map((r) => `• ${r.title}: ${abs(`/receita/${r.slug}`)}`).join('\n')}\n\nCancelar inscrição: ${unsubscribeUrl(email)}`,
    html: mail.layout({
      title: 'Bem-vindo(a)!',
      preheader: 'Sua inscrição foi confirmada',
      body: `<h1 style="font-size:22px;margin:0 0 12px">Inscrição confirmada! 🎉</h1>
        <p>Que bom ter você por aqui. Sempre que sair receita nova, ela chega no seu e-mail.</p>
        ${recent.length ? `<h2 style="font-size:17px;margin:20px 0 10px">Para começar, as mais recentes:</h2>${recent.map(recipeBlock).join('')}` : ''}
        <p style="color:#5d554d;font-size:14px">Dica: no site, toque em <b>Modo cozinha</b> para seguir a receita passo a passo, com timers.</p>`,
      footer: newsletterFooter(email),
    }),
  });
}

// ---------------------------------------------------------------------------
// Envio da newsletter (fila em segundo plano, com velocidade controlada e retomada)
// ---------------------------------------------------------------------------
function campaignEmail(campaign, recipe, email) {
  const s = settings.all();
  const url = abs(`/receita/${recipe.slug}?utm_source=newsletter&utm_medium=email&utm_campaign=c${campaign.id}`);
  const r = { ...recipe, slug: `${recipe.slug}?utm_source=newsletter&utm_medium=email&utm_campaign=c${campaign.id}`, total: (recipe.prep_minutes || 0) + (recipe.cook_minutes || 0) + (recipe.rest_minutes || 0) };
  return {
    to: email,
    subject: campaign.subject,
    headers: listHeaders(email),
    text: `${campaign.intro ? `${campaign.intro}\n\n` : ''}${recipe.title}\n${recipe.description || ''}\n\nVer receita: ${url}\n\n—\n${s.siteName}\nCancelar inscrição: ${unsubscribeUrl(email)}`,
    html: mail.layout({
      title: campaign.subject,
      preheader: recipe.description || recipe.title,
      body: `${campaign.intro ? mail.paragraphs(campaign.intro) : ''}${recipeBlock(r)}${mail.button(url, 'Ver a receita completa')}`,
      footer: newsletterFooter(email),
    }),
  };
}

function confirmedCount() {
  return db.get().prepare("SELECT COUNT(*) AS n FROM subscribers WHERE status = 'confirmed'").get().n;
}

function createCampaign({ recipeId, subject, intro, userId }) {
  const d = db.get();
  const recipe = d.prepare("SELECT * FROM recipes WHERE id = ? AND status = 'published'").get(recipeId);
  if (!recipe) throw Object.assign(new Error('Escolha uma receita publicada'), { status: 400 });
  if (!mail.isConfigured()) throw Object.assign(new Error('Configure o e-mail (SMTP) antes de enviar a newsletter'), { status: 400 });
  if (!mail.siteUrl()) throw Object.assign(new Error('Defina o endereço do site (Configurações → E-mail) para os links funcionarem'), { status: 400 });
  const total = confirmedCount();
  if (!total) throw Object.assign(new Error('Ainda não há inscritos confirmados'), { status: 400 });
  const subj = String(subject || `Receita nova: ${recipe.title}`).replace(/[\r\n]+/g, ' ').trim().slice(0, 150);
  const info = d.prepare("INSERT INTO newsletter_campaigns (recipe_id, subject, intro, status, total, created_by) VALUES (?, ?, ?, 'sending', ?, ?)").run(recipe.id, subj, String(intro || '').slice(0, 3000), total, userId ?? null);
  const id = Number(info.lastInsertRowid);
  kick();
  return d.prepare('SELECT * FROM newsletter_campaigns WHERE id = ?').get(id);
}

async function sendCampaignTest({ recipeId, subject, intro, to }) {
  const recipe = db.get().prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId);
  if (!recipe) throw Object.assign(new Error('Receita não encontrada'), { status: 404 });
  const fake = { id: 0, subject: `[TESTE] ${String(subject || `Receita nova: ${recipe.title}`).replace(/[\r\n]+/g, ' ').slice(0, 140)}`, intro: String(intro || '').slice(0, 3000) };
  await mail.send(campaignEmail(fake, recipe, to));
}

let running = false;
let timer = null;
const sleep = (ms) => new Promise((r) => { timer = setTimeout(r, ms); timer.unref?.(); });

/** Processa as campanhas pendentes, uma mensagem por vez, respeitando MAIL_RATE_PER_MIN. */
async function worker() {
  if (running) return;
  running = true;
  try {
    const d = db.get();
    for (;;) {
      const c = d.prepare("SELECT * FROM newsletter_campaigns WHERE status = 'sending' ORDER BY id LIMIT 1").get();
      if (!c) break;
      const recipe = c.recipe_id ? d.prepare('SELECT * FROM recipes WHERE id = ?').get(c.recipe_id) : null;
      if (!recipe) {
        d.prepare("UPDATE newsletter_campaigns SET status = 'failed', last_error = 'Receita removida', finished_at = datetime('now') WHERE id = ?").run(c.id);
        continue;
      }
      const next = d.prepare("SELECT id, email FROM subscribers WHERE status = 'confirmed' AND id > ? ORDER BY id LIMIT 1").get(c.cursor);
      if (!next) {
        d.prepare("UPDATE newsletter_campaigns SET status = 'done', finished_at = datetime('now') WHERE id = ?").run(c.id);
        continue;
      }
      try {
        await mail.send(campaignEmail(c, recipe, next.email));
        d.prepare('UPDATE newsletter_campaigns SET sent = sent + 1, cursor = ? WHERE id = ?').run(next.id, c.id);
      } catch (e) {
        d.prepare('UPDATE newsletter_campaigns SET failed = failed + 1, cursor = ?, last_error = ? WHERE id = ?').run(next.id, String(e.message).slice(0, 300), c.id);
        // Muitas falhas seguidas (ex.: senha do SMTP mudou): pausa para não queimar a lista
        const cur = d.prepare('SELECT sent, failed FROM newsletter_campaigns WHERE id = ?').get(c.id);
        if (cur.failed >= 10 && cur.failed > cur.sent) d.prepare("UPDATE newsletter_campaigns SET status = 'paused' WHERE id = ?").run(c.id);
      }
      await sleep(Math.round(60000 / mail.rate()));
    }
  } catch (e) {
    console.error('[newsletter] erro no envio:', e.message);
  } finally {
    running = false;
  }
}

function kick() {
  setImmediate(() => worker());
}

function cancelCampaign(id) {
  return db.get().prepare("UPDATE newsletter_campaigns SET status = 'cancelled', finished_at = datetime('now') WHERE id = ? AND status IN ('sending', 'paused')").run(id).changes > 0;
}
function resumeCampaign(id) {
  const ok = db.get().prepare("UPDATE newsletter_campaigns SET status = 'sending', last_error = '' WHERE id = ? AND status = 'paused'").run(id).changes > 0;
  if (ok) kick();
  return ok;
}
function isIdle() {
  return !running;
}

module.exports = {
  notifyAccountChange,
  sendPasswordReset, sendInvite, createResetToken, findResetToken, consumeResetToken,
  notifyComment, subscribe, confirmSubscription, unsubscribe, unsubscribeToken, unsubscribeUrl, sendWelcome,
  createCampaign, sendCampaignTest, cancelCampaign, resumeCampaign, confirmedCount, kick, isIdle, background,
};
