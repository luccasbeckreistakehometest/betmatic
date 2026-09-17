# Betmatic — subir na Hostinger (VPS)

Precisa de **VPS** (não hospedagem compartilhada): Node contínuo, SQLite em disco, e um
Chromium **com janela** para o sweep da Betano — headless recebe zero elementos do widget
de mercados, então o servidor roda dentro de um display virtual (`xvfb`). Tudo isso já
está no Dockerfile; você só precisa de Docker no VPS.

## 1. VPS
hPanel → **VPS** → **KVM 2** (8 GB) recomendado — Chromium + build do Next passam de 4 GB.
Template **Ubuntu 24.04 com Docker**. Aponte o DNS (registro A) para o IP.

## 2. Código e `.env`
```bash
ssh root@SEU_IP
git clone https://SEU-REPO.git betmatic && cd betmatic
cp .env.example .env && nano .env
```
| chave | de onde |
|---|---|
| `AUTH_SECRET` | `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | console.anthropic.com — **com crédito**; sem ela o job de 4h não gera nada novo, mas o app serve o que já tem |
| `CRON_SECRET` | qualquer string longa; o sidecar `cron` usa pra chamar `/api/cron/refresh` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | sua conta admin (plano Max permanente, criada no primeiro boot) |
| `MP_ACCESS_TOKEN` | Mercado Pago → credenciais de **produção** (é o mesmo do AgencyHub) |
| `NEXT_PUBLIC_BASE_URL` | `https://seu-dominio.com` |

## 3. Subir
```bash
docker compose up -d --build
docker compose logs -f app       # "Ready" — o Xvfb sobe junto
```
Dois serviços: `app` (Next sob `xvfb-run`) e `cron` (chama o refresh a cada 4 h).
Volumes: `./data` (banco + research) e `./browser-profiles` (sessão da Betano — cookies
aceitos, perfil "visitante recorrente"; sem ele a Betano volta a bloquear).

## 4. HTTPS (Caddy)
```bash
apt install -y caddy
printf 'seu-dominio.com {\n  reverse_proxy localhost:3000\n}\n' > /etc/caddy/Caddyfile
systemctl reload caddy
```

## 5. Mercado Pago
Webhook em **Suas integrações → Webhooks**: `https://seu-dominio.com/api/webhooks/mercadopago`,
evento *Pagamentos*. Coins e planos entram sozinhos.

## 6. O job de 4 horas
- `cron` → `POST /api/cron/refresh?maxGames=8` com `x-cron-secret`.
- Primeira execução: `docker compose exec app xvfb-run -a npx tsx scripts/…` não é
  necessário — basta esperar o sidecar ou disparar pelo painel `/admin` ("rodar agora").
- A Betano limita por volume; o job já espaça as chamadas. Se aparecer 403 nos logs, é
  o perfil sendo bloqueado: apague `browser-profiles/betano` e deixe recriar.
- O que **não** está resolvido e vale saber: painel de estatísticas ao vivo da Betano não
  popula nem em janela; bet365 é ilegível; mercados de faltas por jogador só existem em
  alguns jogos. O app é honesto sobre isso nas notas de cada bilhete.

## 7. Telegram (alertas dos times seguidos)
1. Crie o bot no @BotFather: o token vai em `TELEGRAM_BOT_TOKEN`, o @ do bot (sem @) em `TELEGRAM_BOT_USERNAME`.
2. Aponte o webhook para o app, com o mesmo segredo de `TELEGRAM_WEBHOOK_SECRET`:
   ```bash
   curl "https://api.telegram.org/bot$TOKEN/setWebhook?url=https://seu-dominio.com/api/telegram/webhook&secret_token=$TELEGRAM_WEBHOOK_SECRET"
   ```
3. O usuário conecta em `/app/alerts` (código de uso único, `/start CÓDIGO` no bot) e segue ligas e times.
   Quando o jogo de um deles ganha bilhetes, o aviso chega no Telegram; sem chat conectado, fica na
   lista de avisos do próprio app.
4. Resumo "seus bilhetes de hoje": o sidecar chama `?job=digest` de hora em hora e o servidor envia uma
   vez por dia depois de `TELEGRAM_DIGEST_HOUR` (padrão 9, horário de Brasília). Para disparar na mão:
   `POST /api/cron/refresh?job=digest&force=1` com `x-cron-secret` ou logado como admin.

Sem `TELEGRAM_BOT_TOKEN` o recurso fica escondido no app e nada é chamado.

## 8. Operar
```bash
docker compose logs --tail 200 app
cp data/betmatic.db backups/$(date +%F).db      # cron diário
docker compose pull && docker compose up -d --build
```
Painel: `/admin` — execuções do job, custo de IA, usuários, receita, funil do tour.

Local: `pnpm dev` · `pnpm test` (unit) · `pnpm e2e` (Playwright; semeia o jogo Sevilha x Valencia).
