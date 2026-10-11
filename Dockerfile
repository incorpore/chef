# syntax=docker/dockerfile:1
# Imagem do Chef — multi-arquitetura (amd64 e arm64), pronta para ZimaOS/CasaOS, Unraid, Synology e afins.

# 1) Dependências de produção (camada separada = builds mais rápidos)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# 2) Imagem final, enxuta
FROM node:22-alpine
LABEL org.opencontainers.image.title="Chef" \
      org.opencontainers.image.description="Blog de receitas PWA com modo cozinha, busca por código, API, AdSense e afiliados Amazon" \
      org.opencontainers.image.source="https://github.com/incorpore/chef" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    UPLOADS_DIR=/app/uploads \
    PUID=1000 \
    PGID=1000 \
    TZ=America/Sao_Paulo

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /app/data /app/uploads \
 && chown -R node:node /app/data /app/uploads

# Banco de dados (data) e fotos/vídeos (uploads) ficam fora do container
VOLUME ["/app/data", "/app/uploads"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# O Node encerra de forma limpa ao receber SIGTERM (docker stop): fecha o servidor e o banco
STOPSIGNAL SIGTERM
CMD ["node", "--disable-warning=ExperimentalWarning", "scripts/docker-start.js"]
