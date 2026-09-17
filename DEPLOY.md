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
| `AUTH_SECRET` | `openssl rand -hex 32` — **obrigatória**: sem ela o servidor não sobe |
| `CRON_SECRET` | `openssl rand -hex 24`; o sidecar `cron` manda no header `x-cron-secret` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | sua conta admin (criada no primeiro boot). Cadastro público **nunca** vira admin |
| `APP_URL` e `NEXT_PUBLIC_BASE_URL` | `https://seu-dominio.com` — lidos em tempo de execução; sem eles o checkout fica desligado |
| `ANTHROPIC_API_KEY` | console.anthropic.com — **com crédito** |
| `AI_DAILY_BUDGET_USD` | teto de gasto de IA por dia (padrão 20; `0` desliga a IA). Aparece no `/admin` |
| `MP_ACCESS_TOKEN` | Mercado Pago → credenciais de **produção** |
| `MP_WEBHOOK_SECRET` | opcional: "assinatura secreta" do webhook no painel do MP (confere o `x-signature`) |
| `LEGAL_NAME`, `LEGAL_DOCUMENT`, `LEGAL_ADDRESS`, `LEGAL_EMAIL` | identificação que aparece em Termos/Privacidade/Reembolso. Vazio = a linha some e as páginas apontam pro formulário de contato |
| `SUPPORT_EMAIL`, `SUPPORT_WHATSAPP` | opcionais; aparecem no rodapé e em /contato quando preenchidos |

O `.dockerignore` deixa `.env*` fora da imagem: nenhum segredo vai para uma camada Docker. Por isso
os valores `NEXT_PUBLIC_*` são lidos em tempo de execução (`src/lib/base-url.ts`), não no build.

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
Cada checkout já informa ao MP a URL de notificação (`APP_URL/api/webhooks/mercadopago`) e as de
retorno (`/pagamento/sucesso|falhou|pendente`). Registre também o webhook em **Suas integrações →
Webhooks** (evento *Pagamentos*) e copie a assinatura secreta para `MP_WEBHOOK_SECRET`.
Com a assinatura configurada, uma notificação com `x-signature` errado é recusada (401); uma sem
assinatura é aceita e registrada no log (`payments.webhook.unsigned`), porque o pagamento é sempre
relido na API do MP com o nosso token. Teste com o simulador de notificações do painel antes da
primeira venda.
O webhook é idempotente (cada pagamento é creditado uma vez), só credita a compra indicada no
`external_reference`, responde 5xx quando o MP não responde (o MP tenta de novo) e desfaz o crédito em
estorno ou contestação. Planos são **pré-pagos** e não renovam sozinhos. Depois de subir, faça uma
compra real de valor baixo e confira em `/admin → Pagamentos`.

## 6. O job de 4 horas
- `cron` → `POST /api/cron/refresh?maxGames=8` com `x-cron-secret`.
- Primeira execução: `docker compose exec app xvfb-run -a npx tsx scripts/…` não é
  necessário — basta esperar o sidecar ou disparar pelo painel `/admin` ("rodar agora").
- A Betano limita por volume; o job já espaça as chamadas. Se aparecer 403 nos logs, é
  o perfil sendo bloqueado: apague `browser-profiles/betano` e deixe recriar.
- O que **não** está resolvido e vale saber: painel de estatísticas ao vivo da Betano não
  popula nem em janela; bet365 é ilegível; mercados de faltas por jogador só existem em
  alguns jogos. O app é honesto sobre isso nas notas de cada bilhete.

## 6b. Jobs da rodada 3 (sidecar)
O sidecar chama `POST /api/cron/refresh?job=…` com `x-cron-secret`. Todos são idempotentes e escrevem uma
linha JSON no log (`job.lineups`, `job.close`, `job.weekly`, `job.cleanup`, `job.featured`):

| job | quando | o que faz |
|---|---|---|
| `lineups` | a cada tick (15 min) | vigia de escalação: bilhetes pendentes com jogo nas próximas 100 min contra escalação e lesões (ESPN), no máximo 30 jogos por tick |
| `close` | a cada tick | CLV: odd de fechamento das pernas cujo jogo começa em até 15 min |
| `weekly` | de hora em hora | relatório semanal; só escreve na segunda a partir das 12:00 UTC (`force=1` para rodar agora) |
| `cleanup` | 1 vez por dia | apaga eventos de medição com mais de 180 dias |
| `featured` | junto do refresh (a cada 4 h) | destaques do dia; roda mesmo com `CRON_ENABLED=0` |

No stack de produção (`/srv/apps/stack/docker-compose.yml`, serviço `betmatic-cron`) acrescente as mesmas
linhas do `docker-compose.yml` deste repositório.

Fontes de dados: tudo vem do JSON público da ESPN (placar, escalação, odds de abertura/atual/fechamento
e linhas de jogador do provedor 100). Se a ESPN mudar esse formato, o caminho licenciado é a
The Odds API (plano pago com props). Os caminhos de captura da Betano/Sofascore com navegador não são
usados pelos recursos da rodada 3.

Privacidade: prints de bilhete são lidos em memória e descartados (só o tamanho vai para o log); o texto
colado no raio-x do tipster é descartado depois da extração; a medição de uso não grava IP.

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
docker compose logs --tail 200 app | grep '"event"'   # uma linha JSON por job (settle, digest, learn, refresh)
curl -s https://seu-dominio.com/api/health            # {"ok":true,"db":true}
docker compose pull && docker compose up -d --build
```
Painel `/admin`: gasto de IA do dia contra o teto, erros recentes, usuários (plano, coins, senha
provisória, desativar), pagamentos, caixa de contato, execuções do job (execução que falhou inteira
aparece como `error`), funil do tour.

Local: `pnpm dev` · `pnpm test` (unit) · `pnpm e2e` (Playwright; semeia o jogo Sevilha x Valencia).
