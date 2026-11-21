'use strict';
/**
 * Gera de uma vez as versões leves (AVIF e WebP, 640 e 1280 px) de todas as fotos já enviadas.
 * Opcional: sem isso, as versões são criadas na primeira visita. Útil depois de atualizar o site.
 *
 *   node scripts/optimize-images.js              (no Docker: docker exec -u 1000:1000 chef node scripts/optimize-images.js)
 *   node scripts/optimize-images.js --todos      (todos os tamanhos: 320 a 1920 px)
 */
const fs = require('node:fs');
const config = require('../src/config');
const images = require('../src/images');

(async () => {
  if (!images.available()) { console.error('A biblioteca de imagens (sharp) não está disponível.'); process.exit(1); }
  const all = process.argv.includes('--todos');
  const widths = all ? images.WIDTHS.filter((w) => w >= 320) : [640, 1280];
  const files = fs.readdirSync(config.uploadsDir).filter((f) => /\.(jpe?g|png|webp|gif|avif)$/i.test(f));
  console.log(`🖼️  ${files.length} fotos · tamanhos: ${widths.join(', ')} px · formatos: AVIF e WebP`);
  let i = 0;
  const t0 = Date.now();
  for (const f of files) {
    await images.warm(f, widths, ['avif', 'webp']);
    if (++i % 10 === 0 || i === files.length) process.stdout.write(`\r   ${i}/${files.length}`);
  }
  console.log(`\n✅ Pronto em ${Math.round((Date.now() - t0) / 1000)} s.`);
})().catch((e) => { console.error(e); process.exit(1); });
