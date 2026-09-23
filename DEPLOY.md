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
| `ANTHROPIC_API_KEY` | console.anthropic.com — **com crédito**. Só é usada enquanto `AI_PROVIDER` for `anthropic` |
| `AI_PROVIDER` | `anthropic` (padrão) ou `openai`. Veja a seção **9. OpenAI** |
| `AI_DAILY_BUDGET_USD` | teto de gasto de IA por dia (padrão 20; `0` desliga a IA). Vale para admin também. Aparece no `/admin` |
| `ADMIN_GAMES_PER_DAY` | gerações por admin por dia (padrão 15; `0` trava a conta admin). Veja **9.3** |
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
linha JSON no log (`job.lineups`, `job.close`, `job.weekly`, `job.cleanup`, `job.featured`, `job.books`):

| job | quando | o que faz |
|---|---|---|
| `lineups` | a cada tick (15 min) | vigia de escalação: bilhetes pendentes com jogo nas próximas 100 min contra escalação e lesões (ESPN), no máximo 30 jogos por tick |
| `close` | a cada tick | CLV: odd de fechamento das linhas cujo jogo começa em até 30 min (janela maior que o intervalo do cron) |
| `weekly` | de hora em hora | relatório semanal; só escreve na segunda a partir das 12:00 UTC (`force=1` para rodar agora) |
| `cleanup` | 1 vez por dia | apaga eventos de medição com mais de 180 dias |
| `featured` | junto do refresh (a cada 4 h) | destaques do dia; roda mesmo com `CRON_ENABLED=0` |
| `books` | a cada tick | preços das casas brasileiras (Superbet, KTO, EstrelaBet e as outras da Altenar, Betfair Exchange, Sportingbet, Betnacional) para todo jogo das próximas 48 h, só pré-jogo. **Desligado até `BR_BOOKS` ser definido** (`all` ou a lista de ids em `.env.example`); cada casa tem timeout com cancelamento e erro isolados, o tick inteiro respeita `BOOKS_JOB_BUDGET_MS`, o histórico é apagado depois de `BOOKS_RETENTION_DAYS`; o painel admin liga/desliga cada casa; `pnpm tsx scripts/books-run.mts wnba` roda o mesmo job no shell; cada linha e cada bilhete ganham um link "Abrir na casa" (bilhete já montado na Superbet, KTO e Sportingbet; página do mercado na Betfair Exchange; página do jogo na Betnacional), com tag de afiliado opcional por casa em `BOOK_AFFILIATE_<CASA>` (`.env.example`) |

No stack de produção (`/srv/apps/stack/docker-compose.yml`, serviço `betmatic-cron`) acrescente as mesmas
linhas do `docker-compose.yml` deste repositório.

Fontes de dados: tudo vem do JSON público da ESPN (placar, escalação, odds de abertura/atual/fechamento
e linhas de jogador do provedor 100). Se a ESPN mudar esse formato, o caminho licenciado é a
The Odds API (plano pago com props). Os caminhos de captura da Betano/Sofascore com navegador não são
usados pelos recursos da rodada 3.

Trava de linha vencida (jogo em andamento): as props da ESPN são **de antes do jogo** e não se mexem
depois que a bola sobe — num jogo em andamento a linha "mais de 7,5 pontos" continua publicada mesmo com
a jogadora em 10. Por isso, quando o jogo está ao vivo, o app lê o box score da súmula da ESPN (a mesma
que o painel ao vivo consulta, cache de 45 s) e, antes de qualquer geração, descarta as linhas já
decididas — o over que não pode mais perder e o under que não pode mais ganhar, incluindo os mercados
combinados (P+R, P+A, R+A, P+R+A). As que sobram vão para o modelo com o que ainda falta e quantos
minutos restam, e o bloco de props avisa que os preços são **referência de antes do jogo**. Sem box
score (jogo não começou, ESPN fora do ar) nada é descartado: a trava só remove o que consegue provar.
O painel ao vivo diz a mesma coisa em uma frase para quem está lendo os bilhetes. O que ainda falta para
um modo ao vivo de verdade é **odd ao vivo** — não existe fonte gratuita para isso: enquanto não entrar um feed
licenciado (The Odds API, plano com props e in-play), a leitura ao vivo continua descrevendo o que mudou
e mandando conferir o preço na casa, sem precificar nada sozinha.

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
Painel `/admin`: gasto de IA do dia contra o teto, **provedor e os quatro modelos em uso**,
**gerações de hoje por usuário** (jogos contra o limite do admin, múltiplas e custo), erros recentes,
usuários (plano, coins, senha provisória, desativar), pagamentos, caixa de contato, execuções do job
(execução que falhou inteira aparece como `error`), funil do tour.

Local: `pnpm dev` · `pnpm test` (unit) · `pnpm e2e` (Playwright; semeia o jogo Sevilha x Valencia).

## 9. OpenAI (trocar de provedor)

Uma variável troca **todas** as chamadas de modelo. Nada muda até ela dizer `openai`: prompts,
schemas, telas e preços continuam iguais, só quem responde é outro. Tudo passa pelo mesmo ponto
único (`generateStructuredWithUsage`), então os dois lados suportam prompt de sistema, prompt do
usuário, imagens em base64 (a leitura de print de bilhete), schema Zod em *structured output*
estrito, teto de tokens de saída e a contagem de tokens que alimenta o teto de gasto.

### 9.1 O que colocar no `.env`

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=sk-proj-...
```

Só isso já roda, com os padrões abaixo. `ANTHROPIC_API_KEY` pode ficar no arquivo: ela deixa de
ser lida. Para voltar atrás, apague a linha `AI_PROVIDER` (ou ponha `anthropic`) e suba de novo.

### 9.2 Modelos (padrões e preços)

Os padrões são a faixa barata da geração atual, porque quem gera não é você.

| variável | para quê | padrão | USD por 1M tokens (entrada / cache / saída) |
|---|---|---|---|
| `OPENAI_MODEL` | brief e montagem dos bilhetes | `gpt-5.6-terra` | 2,00 / 0,20 / 12,00 |
| `OPENAI_EXTRACTION_MODEL` | extração das páginas e tradução | `gpt-5.6-luna` | 0,20 / 0,02 / 1,20 |
| `OPENAI_CHEAP_MODEL` | print de bilhete (visão), tipster, textos curtos, leitura de jogador | `gpt-5.6-luna` | 0,20 / 0,02 / 1,20 |
| `OPENAI_LIVE_MODEL` | leitura ao vivo | `gpt-5.6-luna` | 0,20 / 0,02 / 1,20 |
| `OPENAI_REASONING_EFFORT` | quanto o modelo pensa antes de responder | `low` | — |

Preços lidos em developers.openai.com/api/docs/pricing em 21/09/2026. Eles entram na tabela de
`src/lib/ai/client.ts`, que é o que mantém o teto diário honesto — um modelo fora da tabela é
cobrado pelo preço do mais caro do provedor, para o teto errar para o lado seguro.

> **Confirme os ids quando a chave chegar.** Eles foram escolhidos da lista publicada, sem conta
> para verificar. `curl -s https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY" | grep gpt-5.6`
> resolve em um segundo. O servidor também pergunta sozinho no boot e escreve no log
> `{"scope":"ai.models","message":"AI_PROVIDER=openai: the account does not list …"}` quando um id
> configurado não está na conta.

`OPENAI_REASONING_EFFORT` existe por um motivo prático: no OpenAI os tokens de raciocínio contam
dentro do teto de saída **e** são cobrados como saída. Com `low` a resposta sobra; com `medium` um
schema curto (1.500 tokens) pode ser cortado antes do JSON. `off` remove o campo, que é o que um
modelo sem raciocínio precisa.

### 9.3 Entregar um login de admin para outra pessoa, com segurança

Quatro camadas, nesta ordem, e nenhuma delas pula o admin:

1. **Teto de gasto do dia** — `AI_DAILY_BUDGET_USD` (padrão 20). É conferido em **toda** chamada de
   modelo, antes de sair. Estourou, para tudo até a virada do dia de Brasília. Para um convidado,
   `AI_DAILY_BUDGET_USD=3` já é folgado com os modelos acima.
2. **Gerações por admin por dia** — `ADMIN_GAMES_PER_DAY` (padrão 15), contadas por conta, separadas
   de `ON_DEMAND_USER_DAILY_CAP`. Jogos e múltiplas cruzadas têm a mesma cota, cada uma no seu
   contador. Quem bate o limite vê a mensagem, não uma tela parada. `0` trava a conta.
3. **Trava por jogo** — dez pessoas abrindo o mesmo jogo pagam uma geração só.
4. **Teto global** — `ON_DEMAND_DAILY_CAP` segura a plataforma inteira (o admin passa por cima
   deste, e só deste).

Uma chamada que falhou ou que o modelo recusou **não** consome a cota de ninguém (a linha é apagada
e o jogo pode ser tentado de novo), mas o que o provedor cobrou **é** registrado no gasto do dia.

Antes de passar a senha:

```bash
# no .env do servidor
AI_DAILY_BUDGET_USD=3
ADMIN_GAMES_PER_DAY=5
```

E, do lado da OpenAI, ponha um limite mensal no projeto da chave (Settings → Limits). Esse é o único
teto que não depende deste código estar certo.

Depois, `/admin` mostra provedor, os quatro modelos, o gasto do dia contra o teto e **quem gerou o
quê hoje**, com o contador de cada admin ao lado do limite.

### 9.4 Trocar de provedor ou baixar o teto, sem reconstruir nada

`AI_PROVIDER`, `OPENAI_*`, `AI_DAILY_BUDGET_USD` e `ADMIN_GAMES_PER_DAY` são lidos em tempo de
execução, do `env_file`. Editar e recriar o contêiner basta — não há build no caminho.

```bash
# stack de produção (serviços betmatic + betmatic-cron)
nano /srv/apps/betmatic/.env
cd /srv/apps/stack && docker compose up -d betmatic

# neste repositório (serviços app + cron)
nano .env && docker compose up -d app
```

Depois, confirme no log do boot que nenhum id de modelo ficou para trás:

```bash
docker compose logs --tail 200 betmatic | grep ai.models   # silêncio = todos os ids existem na conta
```
