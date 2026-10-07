'use strict';
const crypto = require('node:crypto');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I para evitar confusão

function randomCode(len = 6) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}

/** Normaliza um código digitado pelo usuário: "#ab-12c" -> "AB12C". */
function normalizeCode(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function stripAccents(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function slugify(s) {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'receita';
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Markdown minimalista e seguro (escapa HTML antes): parágrafos, **negrito**, *itálico*, links, listas, títulos. */
function miniMarkdown(src) {
  if (!src) return '';
  const blocks = String(src).replace(/\r/g, '').split(/\n{2,}/);
  const inline = (t) =>
    esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, '<a href="$2" rel="noopener">$1</a>')
      .replace(/\n/g, '<br>');
  return blocks
    .map((b) => {
      const t = b.trim();
      if (!t) return '';
      const h = t.match(/^(#{2,4})\s+(.+)$/);
      if (h) return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
      if (/^[-*]\s+/.test(t)) {
        const items = t.split('\n').map((l) => `<li>${inline(l.replace(/^[-*]\s+/, ''))}</li>`);
        return `<ul>${items.join('')}</ul>`;
      }
      if (/^\d+[.)]\s+/.test(t)) {
        const items = t.split('\n').map((l) => `<li>${inline(l.replace(/^\d+[.)]\s+/, ''))}</li>`);
        return `<ol>${items.join('')}</ol>`;
      }
      return `<p>${inline(t)}</p>`;
    })
    .join('\n');
}

// ---------------- Ingredientes ----------------
const UNICODE_FRACTIONS = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅕': 0.2, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
const WORD_NUMBERS = { um: 1, uma: 1, dois: 2, duas: 2, 'três': 3, tres: 3, quatro: 4, cinco: 5, seis: 6, meia: 0.5, meio: 0.5, 'dúzia': 12 };

// Unidades conhecidas (forma canônica → variações). Ordem importa: mais específicas primeiro.
const UNITS = [
  ['xícara', ['xícaras', 'xicaras', 'xícara', 'xicara', 'xíc.', 'xic.', 'xíc', 'xic', 'cups', 'cup']],
  ['colher de sopa', ['colheres de sopa', 'colher de sopa', 'colheres (sopa)', 'colher (sopa)', 'c. de sopa', 'c. sopa', 'csopa', 'cs', 'tablespoons', 'tablespoon', 'tbsp']],
  ['colher de chá', ['colheres de chá', 'colher de chá', 'colheres de cha', 'colher de cha', 'colheres (chá)', 'colher (chá)', 'c. de chá', 'c. chá', 'cc', 'teaspoons', 'teaspoon', 'tsp']],
  ['colher de sobremesa', ['colheres de sobremesa', 'colher de sobremesa', 'colheres (sobremesa)', 'colher (sobremesa)']],
  ['colher', ['colheres', 'colher']],
  ['kg', ['quilos', 'quilo', 'kgs', 'kg']],
  ['g', ['gramas', 'grama', 'gr', 'g']],
  ['mg', ['mg']],
  ['l', ['litros', 'litro', 'lt', 'l']],
  ['ml', ['mililitros', 'mililitro', 'ml']],
  ['copo', ['copos americanos', 'copo americano', 'copos', 'copo']],
  ['lata', ['latas', 'lata']],
  ['caixa', ['caixinhas', 'caixinha', 'caixas', 'caixa']],
  ['pacote', ['pacotes', 'pacote', 'pct']],
  ['dente', ['dentes', 'dente']],
  ['fatia', ['fatias', 'fatia']],
  ['pitada', ['pitadas', 'pitada']],
  ['maço', ['maços', 'maço', 'maco']],
  ['ramo', ['ramos', 'ramo']],
  ['unidade', ['unidades', 'unidade', 'un', 'und']],
  ['tablete', ['tabletes', 'tablete']],
  ['envelope', ['envelopes', 'envelope']],
  ['oz', ['ounces', 'ounce', 'oz']],
  ['lb', ['pounds', 'pound', 'lbs', 'lb']],
];
const UNIT_LOOKUP = [];
for (const [canon, vars] of UNITS) for (const v of vars) UNIT_LOOKUP.push([v, canon]);
UNIT_LOOKUP.sort((a, b) => b[0].length - a[0].length);

function parseNumberToken(tok) {
  if (!tok) return null;
  tok = tok.trim().replace(',', '.');
  if (UNICODE_FRACTIONS[tok] !== undefined) return UNICODE_FRACTIONS[tok];
  const mixedUni = tok.match(/^(\d+)\s*([½⅓⅔¼¾⅕⅛⅜⅝⅞])$/);
  if (mixedUni) return Number(mixedUni[1]) + UNICODE_FRACTIONS[mixedUni[2]];
  const frac = tok.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : null;
  if (/^\d+(\.\d+)?$/.test(tok)) return Number(tok);
  return null;
}

const QTY_RE = /^((?:\d+\s+\d+\/\d+)|(?:\d+\s*[½⅓⅔¼¾⅕⅛⅜⅝⅞])|(?:\d+\/\d+)|(?:\d+(?:[.,]\d+)?)|[½⅓⅔¼¾⅕⅛⅜⅝⅞])(?:\s*(?:a|-|–|ou)\s*((?:\d+\/\d+)|(?:\d+(?:[.,]\d+)?)))?\s*/;

/**
 * Converte uma linha de texto em ingrediente estruturado.
 * "2 1/2 xícaras de farinha de trigo (peneirada)" -> { quantity: 2.5, unit: 'xícara', name: 'farinha de trigo', note: 'peneirada' }
 */
function parseIngredient(line) {
  const raw = String(line || '').replace(/^[-*•▢☐\s]+/, '').trim();
  const out = { raw, quantity: null, quantityMax: null, unit: '', name: raw, note: '' };
  if (!raw) return out;
  let rest = raw;
  const m = rest.match(QTY_RE);
  if (m) {
    let q = m[1];
    const mixed = q.match(/^(\d+)\s+(\d+\/\d+)$/);
    out.quantity = mixed ? Number(mixed[1]) + parseNumberToken(mixed[2]) : parseNumberToken(q.replace(/\s+/g, ''));
    if (m[2]) out.quantityMax = parseNumberToken(m[2]);
    rest = rest.slice(m[0].length);
  } else {
    const w = rest.match(/^(\S+)\s+/);
    if (w && WORD_NUMBERS[w[1].toLowerCase()] !== undefined) {
      out.quantity = WORD_NUMBERS[w[1].toLowerCase()];
      rest = rest.slice(w[0].length);
    }
  }
  if (out.quantity !== null) {
    const lower = rest.toLowerCase();
    for (const [variant, canon] of UNIT_LOOKUP) {
      if (lower.startsWith(variant) && (lower.length === variant.length || /[\s.(,]/.test(lower[variant.length]) || /\.$/.test(variant))) {
        out.unit = canon;
        rest = rest.slice(variant.length).replace(/^\s*\)?/, '').replace(/^\s*\((?:de\s+)?(?:ch[aá]|sopa|caf[eé]|sobremesa)\)/i, '');
        break;
      }
    }
    rest = rest.replace(/^\s*(de|do|da|dos|das|of)\s+/i, '');
  }
  const note = rest.match(/\s*\(([^)]*)\)\s*$/) || rest.match(/,\s*(.+)$/);
  if (note) {
    out.note = note[1].trim();
    rest = rest.slice(0, note.index);
  }
  out.name = rest.trim() || raw;
  return out;
}

/**
 * Converte texto (uma linha por ingrediente; linhas "## Título" ou terminadas em ":" viram grupos)
 * em lista estruturada.
 */
function parseIngredientsText(text) {
  const list = [];
  let group = '';
  for (const lineRaw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = lineRaw.trim();
    if (!line) continue;
    const g = line.match(/^#{1,4}\s*(.+)$/) || (line.length < 60 && /:$/.test(line) && !/^\d/.test(line) ? [null, line.slice(0, -1)] : null);
    if (g) { group = g[1].trim(); continue; }
    list.push({ ...parseIngredient(line), group });
  }
  return list;
}

function ingredientsToText(list) {
  let group = '';
  const lines = [];
  for (const i of list || []) {
    if ((i.group || '') !== group) {
      group = i.group || '';
      if (group) lines.push(`## ${group}`);
    }
    lines.push(i.raw || [formatQuantity(i.quantity), i.unit, i.name].filter(Boolean).join(' '));
  }
  return lines.join('\n');
}

const NICE_FRACTIONS = [[0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.375, '⅜'], [0.5, '½'], [0.625, '⅝'], [2 / 3, '⅔'], [0.75, '¾'], [0.875, '⅞']];
const PLURALS = { 'xícara': 'xícaras', 'colher de sopa': 'colheres de sopa', 'colher de chá': 'colheres de chá', 'colher de sobremesa': 'colheres de sobremesa', colher: 'colheres', copo: 'copos', lata: 'latas', caixa: 'caixas', pacote: 'pacotes', dente: 'dentes', fatia: 'fatias', pitada: 'pitadas', 'maço': 'maços', ramo: 'ramos', unidade: 'unidades', tablete: 'tabletes', envelope: 'envelopes' };
/** Unidade no plural quando a quantidade for maior que 1 ("2 xícaras"). */
function unitLabel(unit, q) {
  return unit && q > 1 && PLURALS[unit] ? PLURALS[unit] : unit || '';
}

function formatQuantity(q) {
  if (q === null || q === undefined || isNaN(q)) return '';
  const whole = Math.floor(q);
  const frac = q - whole;
  if (frac < 0.04) return String(whole);
  if (frac > 0.96) return String(whole + 1);
  let best = null;
  for (const [v, sym] of NICE_FRACTIONS) {
    const d = Math.abs(frac - v);
    if (d < 0.04 && (!best || d < best[0])) best = [d, sym];
  }
  if (best) return whole ? `${whole} ${best[1]}` : best[1];
  return String(Math.round(q * 100) / 100).replace('.', ',');
}

// ---------------- Passos e tempos ----------------
/** Detecta durações em um texto ("asse por 35 a 40 minutos", "1 hora e meia") e retorna segundos. */
function detectTimers(text) {
  const t = stripAccents(String(text || '').toLowerCase());
  const timers = [];
  const re = /(\d+(?:[.,]\d+)?)(?:\s*(?:a|-|–|ou)\s*(\d+(?:[.,]\d+)?))?\s*(horas?|h\b|hrs?|minutos?|min\b|mins?|segundos?|seg\b|s\b)(\s*e\s*(meia|\d+\s*(?:minutos?|min)))?/g;
  let m;
  while ((m = re.exec(t))) {
    const n = Number((m[2] || m[1]).replace(',', '.'));
    const u = m[3];
    let secs = u.startsWith('h') ? n * 3600 : u.startsWith('m') ? n * 60 : n;
    if (m[5]) secs += m[5] === 'meia' ? 1800 : parseInt(m[5], 10) * 60;
    if (secs >= 5 && secs <= 48 * 3600) timers.push({ seconds: Math.round(secs), label: m[0].trim() });
  }
  return timers;
}

function parseStepsText(text) {
  const steps = [];
  let group = '';
  for (const lineRaw of String(text || '').replace(/\r/g, '').split(/\n+/)) {
    const line = lineRaw.trim();
    if (!line) continue;
    const g = line.match(/^#{1,4}\s*(.+)$/);
    if (g) { group = g[1].trim(); continue; }
    const clean = line.replace(/^(passo\s*)?\d+\s*[.)\-–:]\s*/i, '');
    steps.push({ text: clean, group, image: '', timer: (detectTimers(clean)[0] || {}).seconds || null });
  }
  return steps;
}

function stepsToText(steps) {
  let group = '';
  const lines = [];
  for (const s of steps || []) {
    if ((s.group || '') !== group) {
      group = s.group || '';
      if (group) lines.push(`## ${group}`);
    }
    lines.push(s.text);
  }
  return lines.join('\n');
}

/** ISO 8601 (PT1H30M) -> minutos */
function isoDurationToMinutes(iso) {
  if (!iso || typeof iso !== 'string') return 0;
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?/i);
  if (!m) return 0;
  return Math.round((Number(m[1] || 0) * 1440) + Number(m[2] || 0) * 60 + Number(m[3] || 0) + Number(m[4] || 0) / 60);
}

function minutesToIso(min) {
  min = Math.round(Number(min) || 0);
  if (!min) return undefined;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `PT${h ? h + 'H' : ''}${m ? m + 'M' : ''}`;
}

function formatMinutes(min) {
  min = Math.round(Number(min) || 0);
  if (!min) return '';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

// ---------------- Vídeo ----------------
function parseVideo(input) {
  if (!input) return null;
  if (typeof input === 'object') return input.url ? parseVideo(input.url) || input : null;
  const url = String(input).trim();
  if (!url) return null;
  let m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  if (m) return { type: 'youtube', id: m[1], url };
  m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return { type: 'vimeo', id: m[1], url };
  m = url.match(/tiktok\.com\/.*\/video\/(\d+)/);
  if (m) return { type: 'tiktok', id: m[1], url };
  m = url.match(/instagram\.com\/(?:p|reel)\/([\w-]+)/);
  if (m) return { type: 'instagram', id: m[1], url };
  if (/\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(url) || url.startsWith('/uploads/')) return { type: 'file', url };
  return { type: 'link', url };
}

// ---------------- Amazon ----------------
function amazonUrl(product, tag) {
  let url = product.url || (product.asin ? `https://www.amazon.com.br/dp/${encodeURIComponent(product.asin)}` : '');
  if (!url) return '';
  try {
    const u = new URL(url);
    if (tag && /(^|\.)amazon\.|amzn\./i.test(u.hostname) && !u.searchParams.get('tag')) u.searchParams.set('tag', tag);
    return u.toString();
  } catch {
    return '';
  }
}

function extractAsin(url) {
  const m = String(url || '').match(/(?:\/dp\/|\/gp\/product\/|\/product\/|ASIN=)([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : '';
}

function safeJson(s, fallback) {
  if (s === null || s === undefined || s === '') return fallback;
  if (typeof s !== 'string') return s;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function isSafeUrl(u) {
  if (!u) return true;
  return /^(https?:\/\/|\/(?!\/))/i.test(String(u));
}

module.exports = {
  randomCode, normalizeCode, slugify, stripAccents, esc, miniMarkdown,
  parseIngredient, parseIngredientsText, ingredientsToText, formatQuantity, unitLabel, PLURALS,
  detectTimers, parseStepsText, stepsToText,
  isoDurationToMinutes, minutesToIso, formatMinutes,
  parseVideo, amazonUrl, extractAsin, safeJson, isSafeUrl,
};
