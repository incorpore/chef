#!/bin/sh
# Teste de fumaça da imagem Docker, simulando o ZimaOS (pastas de dados criadas como root,
# acesso por http://IP:porta, instalação com token, reinício do container).
# Uso: sh scripts/smoke-test.sh [imagem]   (padrão: chef:local)
set -eu
IMAGE="${1:-chef:local}"
NAME="chef-smoke-$$"
PORT="${SMOKE_PORT:-18484}"
BASE="http://127.0.0.1:$PORT"
DIR="$(mktemp -d)"
# Token e senha descartáveis, gerados a cada execução
TOKEN="$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
PASS="Pw-$(od -An -N9 -tx1 /dev/urandom | tr -d ' \n')"
JAR="$DIR/cookies.txt"
fail() { echo "❌ $1"; docker logs "$NAME" 2>&1 | tail -30; docker rm -f "$NAME" >/dev/null 2>&1 || true; exit 1; }
ok() { echo "✅ $1"; }
# A pasta data fica com permissão 700 (dono 1000); para conferi-la de fora pode ser preciso sudo
as_root() { if [ "$(id -u)" = "0" ]; then "$@"; else sudo -n "$@"; fi; }
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$DIR" 2>/dev/null || sudo -n rm -rf "$DIR" 2>/dev/null || true; }
trap cleanup EXIT

mkdir -p "$DIR/AppData/chef/data" "$DIR/AppData/chef/uploads"
chmod 755 "$DIR/AppData/chef/data" "$DIR/AppData/chef/uploads"

start() {
  docker run -d --name "$NAME" -p "$PORT:3000" \
    -e TZ=America/Sao_Paulo -e PUID=1000 -e PGID=1000 -e SETUP_TOKEN="$TOKEN" \
    -v "$DIR/AppData/chef/data:/app/data" -v "$DIR/AppData/chef/uploads:/app/uploads" \
    "$IMAGE" >/dev/null
  i=0
  until [ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null)" = "healthy" ]; do
    i=$((i + 1)); [ $i -gt 60 ] && fail "container não ficou saudável em 60s"
    [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" = "true" ] || fail "container parou"
    sleep 1
  done
}

start
ok "container saudável (HEALTHCHECK /healthz)"

USER_ID="$(docker exec "$NAME" sh -c 'cat /proc/1/status | grep ^Uid | cut -f2')"
[ "$USER_ID" = "1000" ] || fail "processo roda com uid $USER_ID (esperado 1000, não root)"
ok "app roda como usuário comum (uid 1000), não como root"

curl -fsS "$BASE/" | grep -q '<html lang="pt-BR">' || fail "página inicial"
ok "página inicial responde"
for p in /css/app.css /js/app.js /manifest.webmanifest /sw.js /icons/icon-192.png /robots.txt /sitemap.xml; do
  curl -fsS -o /dev/null "$BASE$p" || fail "arquivo $p"
done
ok "CSS, JS, manifest PWA, service worker, ícones, robots e sitemap"

curl -fsS -D "$DIR/h" -o /dev/null "$BASE/" ; grep -qi "upgrade-insecure-requests" "$DIR/h" && fail "CSP força HTTPS em acesso HTTP local"
grep -qi "strict-transport-security" "$DIR/h" && fail "HSTS enviado em HTTP"
ok "acesso por HTTP local sem forçar HTTPS"

CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/auth/setup" -H 'content-type: application/json' -d '{"email":"dono@exemplo.com","password":"'"$PASS"'","name":"Dono"}')"
[ "$CODE" = "403" ] || fail "instalação sem token deveria ser recusada (veio $CODE)"
ok "instalação sem token é recusada"

curl -fsS -c "$JAR" -X POST "$BASE/api/v1/auth/setup" -H 'content-type: application/json' -H "origin: $BASE" \
  -d "{\"email\":\"dono@exemplo.com\",\"password\":\"$PASS\",\"name\":\"Dono\",\"siteName\":\"Teste ZimaOS\",\"setupToken\":\"$TOKEN\"}" >/dev/null || fail "instalação com token"
grep -q "chef_session" "$JAR" || fail "cookie de sessão não foi gravado (login não funcionaria em HTTP)"
curl -fsS -b "$JAR" "$BASE/api/v1/auth/me" | grep -q '"email":"dono@exemplo.com"' || fail "sessão não reconhecida"
ok "instalação com token + login funcionando em HTTP"

curl -fsS -b "$JAR" -H "origin: $BASE" -X POST "$BASE/api/v1/recipes" -H 'content-type: application/json' \
  -d '{"title":"Bolo de teste","code":"ZIMA01","ingredients":"2 ovos\n1 xícara de açúcar","steps":"Misture.\nAsse por 30 minutos.","status":"published"}' | grep -q '"code":"ZIMA01"' || fail "criar receita"
curl -fsS "$BASE/receita/bolo-de-teste" | grep -q 'ZIMA01' || fail "página da receita"
ok "receita criada e publicada"

printf '\211PNG\r\n\032\n\000\000\000\rIHDR\000\000\000\001\000\000\000\001\010\006\000\000\000\037\025\304\211\000\000\000\rIDATx\332c\374\317\300P\017\000\004\205\001\200\204\251\214!\000\000\000\000IEND\256B`\202' > "$DIR/foto.png"
UP="$(curl -fsS -b "$JAR" -H "origin: $BASE" -F "files=@$DIR/foto.png;type=image/png" "$BASE/api/v1/uploads")" || fail "upload"
URL="$(echo "$UP" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')"
curl -fsS -o /dev/null "$BASE$URL" || fail "foto enviada não abre"
ok "upload de foto funcionando ($URL)"

docker restart "$NAME" >/dev/null
i=0; until [ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME")" = "healthy" ]; do i=$((i+1)); [ $i -gt 60 ] && fail "não voltou após reiniciar"; sleep 1; done
curl -fsS -b "$JAR" "$BASE/api/v1/auth/me" | grep -q '"email":"dono@exemplo.com"' || fail "sessão perdida após reiniciar"
curl -fsS "$BASE/c/ZIMA01" -o /dev/null -w '%{http_code}' | grep -q 302 || fail "receita perdida após reiniciar"
curl -fsS -o /dev/null "$BASE$URL" || fail "foto perdida após reiniciar"
ok "após reiniciar: receita, foto e login continuam lá (dados persistentes)"

as_root test -f "$DIR/AppData/chef/data/chef.db" || fail "banco não está na pasta montada"
as_root ls "$DIR/AppData/chef/uploads" | grep -q png || fail "foto não está na pasta montada"
[ "$(as_root stat -c %u "$DIR/AppData/chef/data")" = "1000" ] || fail "pasta de dados sem o dono correto"
ok "banco e fotos gravados nas pastas do host (backup fácil)"

docker stop -t 15 "$NAME" >/dev/null
EXIT="$(docker inspect -f '{{.State.ExitCode}}' "$NAME")"
[ "$EXIT" = "0" ] || fail "não encerrou de forma limpa (código $EXIT)"
ok "desliga de forma limpa (docker stop)"

docker rm -f "$NAME" >/dev/null
docker run -d --name "$NAME" -p "$PORT:3000" -e SETUP_TOKEN=troque-este-codigo "$IMAGE" >/dev/null
i=0; until curl -fsS -o /dev/null "$BASE/healthz" 2>/dev/null; do i=$((i+1)); [ $i -gt 30 ] && fail "não subiu"; sleep 1; done
CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/auth/setup" -H 'content-type: application/json' -d "{\"email\":\"a@b.com\",\"password\":\"$PASS\",\"setupToken\":\"troque-este-codigo\"}")"
[ "$CODE" = "403" ] || fail "token de exemplo deveria ser recusado (veio $CODE)"
ok "token de exemplo (troque-este-codigo) é recusado"

echo "🎉 Todos os testes da imagem passaram."
