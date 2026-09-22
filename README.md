# Automação Radar Mobiliza PE

Automatiza a captação diária das conversas 1:1 das sessões da Evolution (WhatsApp) em Pernambuco, registrando todos os contatos no Supabase. Nas próximas etapas, um critério julga o que vira caso e alimenta a base Radar Mobiliza PE (Notion).

## Contexto

Tarefa no Notion: [Automação diária das sessões da Evolution — o privado vira caso no Radar](https://app.notion.com/p/tironalua/Automa-o-di-ria-das-sess-es-da-Evolution-o-privado-vira-caso-no-Radar-3bdb2502d3148129b724ee1188cb46eb?source=copy_link)

- **Problema:** hoje a triagem do que vira caso no Radar é manual. Na semana de 11–14/08, a base "Botando pra Moer" (registro manual da frente de IR) teve **110 contatos**, dos quais **15** tinham cara de caso, e só **2** chegaram ao Radar.
- **Decisão (15/08):** o formulário acaba — ninguém faz triagem caso a caso. A Evolution lê o privado de todas as sessões de PE e a ferramenta julga sozinha o que vira caso.
- **Critério:** é da Maíra (já aplica na mão na Botando pra Moer, que vira a referência de calibração). O motor reaproveita a lógica do "Centro de Pendências" do Lucas.
- **Pessoas:** Lucas (requisito), Maíra Kamilly (critério), Thiago (condução), Vitória (acompanha), Pedro Abib (constrói).

A calibração roda contra a referência dos 15 casos da semana 11–14/08: o motor está certo quando bate perto de **15**, não perto dos **2** que o Radar recebia.

## Arquitetura

```
Evolution (Postgres, cred "admin evo")  ──►  n8n  ──►  Supabase (radar_pe_*)  ──►  Front  ──►  Worker CF  ──►  n8n  ──►  Notion Radar
```

- A captação lê o Postgres da Evolution **direto** (sem REST/apikey), com filtro 1:1 (`@s.whatsapp.net` + `@lid`).
- O Supabase guarda instâncias, chats (transcript + checkpoint) e contatos (registro de negócio).

## Arquivos

| Arquivo | O que é |
| --- | --- |
| `schema.sql` | Tabelas `radar_pe_*` + funções RPC (rodar no SQL Editor do Supabase) |
| `n8n/01_backfill_instancia.json` | Sub: captura o histórico completo de UMA instância |
| `n8n/02_backfill_main.json` | Main: disparo manual → lista instâncias → chama 01 |
| `n8n/03_diario_instancia.json` | Sub: captura incremental (só mensagens novas) de UMA instância |
| `n8n/04_diario_main.json` | Main: cron diário → lista instâncias → chama 03 |
| `n8n/05_health.json` | Cron diário: checa `connectionState` e marca sessões offline |
| `n8n/06_radar_mensagem.json` | Sub: captura 1 mensagem "ao vivo" (webhook) — append + sinais + detecção |
| `n8n/07_notion_create_page.json` | Sub: webhook → cria página no Notion (usa a credencial do node Notion) || `n8n/08_salvar_audio.json` | Sub: detecta emoji-gatilho → chama o `09` pra baixar/sober o áudio |
| `n8n/09_download_audio.json` | Sub: baixa o áudio (Evolution `getBase64FromMediaMessage`) e sobe no Google Drive (usado por 08 e 10) |
| `n8n/10_reenviar_audio.json` | Sub: webhook → reenvia um áudio com erro pro Drive (chamado pelo Worker `/api/audio/resend`) |
| `n8n/11_notion_list.json` | Sub: webhook → consulta o database "Radar Mobiliza PE" no Notion e devolve as páginas (usado pela aba "Radar Mobiliza PE") |
| `n8n/12_notion_list_users.json` | Sub: webhook → lista os usuários do workspace do Notion (usado no vínculo de responsáveis no front) |
| `n8n/13_vigia_missoes.json` | Vigia: captura links de missão de um remetente num grupo da Evolution (aba "Missões") |
| `queries_validacao.md` | Queries pra conferir o resultado do backfill |
| `arquitetura.md` | Desenho técnico (estado atual + Etapas 2b/3) pra alinhamento com o time |
| `front/` | CRM básico (Vite + React + TS) pra ver/editar `radar_pe_contacts` |

## Workflows

### 01 — Backfill Instância (sub)

- **Trigger:** Execute Workflow Trigger (recebe `{ instance_name }`).
- **Fluxo:** `Find Chats` (Postgres, lista 1:1) → `Loop Chats` → `Find Messages` (Postgres, histórico completo) → `Build Transcript` (Code) → `Upsert Chat` (Supabase) → volta pro loop.

### 02 — Backfill (main)

- **Trigger:** Manual.
- **Fluxo:** `Get Instances` (Supabase) → `Loop Instances` → `Execute Instância` (chama 01) → volta pro loop.
- **Uso:** rodar uma vez, fora de horário (pesado).

### 03 — Diário Instância (sub)

- **Trigger:** Execute Workflow Trigger (`{ instance_name }`).
- **Fluxo:** `Find Chats` → `Loop Chats` → `Get Existing` (Supabase, lê transcript+checkpoint) → `Find Messages` (Postgres, `messageTimestamp > checkpoint`) → `Merge` (append) → `Upsert Chat` → loop.

### 04 — Diário (main)

- **Trigger:** Schedule (cron `0 8 * * *`).
- **Fluxo:** igual ao 02, mas chama o 03.

### 05 — Health

- **Trigger:** Schedule (cron `0 9 * * *`).
- **Fluxo:** `Get Instances` → `Loop Instances` → `Connection State` (REST Evolution) → `Extract State` → `Mark Health` (Supabase).

### 06 — Radar Mensagem (sub, tempo real)

- **Trigger:** Execute Workflow Trigger (recebe o evento `messages.upsert` do webhook global).
- **Fluxo:** `Parse Mensagem` (Code: filtra 1:1, canonicaliza jid, extrai body, descarta status/trivial) → `Append Mensagem` (Supabase, RPC `radar_pe_append_message`).
- **Como liga:** é chamado pelo fluxo global do n8n (`Webhook1` em `webhookn8n.tnledu.shop/webhook/evolution-connection`) via um nó `If` (`body.event == 'messages.upsert'`) + `Call`.

### 07 — Notion Create Page (sub)

- **Trigger:** Webhook (`POST /radar-notion`), chamado pelo Worker do Cloudflare (`POST /api/notion/pages`).
- **Fluxo:** `Auth + Normalize` (checa `x-radar-secret`, normaliza os 13 campos) → `Create Page` (Notion) → `Tem responsável?` (Switch) → se houver id de usuário do Notion, `Set Responsável (Notion)` (update da propriedade `people`) → `Respond` (devolve `page_id`/`url`).
- **Responsável:** a propriedade "Responsável pelo contato" é **People** (usuário do workspace). O Worker resolve o nome do responsável (`radar_pe_responsaveis.notion_user_id`) e injeta `responsavel_notion_id`; sem id real (responsável não vinculado ou nome vazio) a página nasce **sem** responsável — nunca quebra.

### 08 — Salvar Áudio (sub, tempo real)

- **Trigger:** Execute Workflow Trigger — chamado pelo `06 - Radar Mensagem` (recebe a mensagem parseada), **só quando a mensagem é nossa** (gate `É nosso?` no `06`).
- **Fluxo:** `Get Triggers` (emoji-gatilho ativos) → `É gatilho?` (Code: `from_me` + mensagem **contém** um emoji-gatilho; sem match → encerra) → `Find Último Áudio` (RPC `radar_pe_find_last_audio`, acha o último `[audio]` do contato) → `Prepara` (sem áudio → encerra) → `Try Create` (RPC `radar_pe_try_create_audio_save`, dedup por `chat_id+trigger_msg_id`) → `É novo?` (If) → `Dados p/ Download` (Set) → chama o `09 - Download Áudio` (baixa + sobe no Drive).
- **Como liga:** o `06` chama o `08` em paralelo ao `Append Mensagem`, mas com um `If` `É nosso?` antes (só mensagens `from_me`). A consulta pesada (`Find Último Áudio`) só roda depois do match de emoji.

### 09 — Download Áudio (sub, compartilhado)

- **Trigger:** Execute Workflow Trigger — recebe `{ instance_name, audio_msg_id, contact_name, phone, audio_ts, save_id }`.
- **Fluxo:** `Busca Mensagem Evo` (Postgres `admin evo`, pega `key`+`message` da Evolution) → `Monta Mensagem` → `FindMedia` (Evolution `getBase64FromMediaMessage`) → `Download OK?` (If) → `To Binary` (base64 → binary; nome `{YYYY-MM-DD_HHhmm}_{instance}_{nome}_{telefone}.{ext}`) → `Google Drive Upload` (pasta fixa) → `Upload OK?` (If) → `Mark Salvo` / `Mark Erro` (RPC `radar_pe_mark_audio_save`).
- **Usado por:** `08` (salvamento automático) e `10` (reenvio manual).

### 10 — Reenviar Áudio (webhook)

- **Trigger:** Webhook `POST /radar-audio-resend` (auth `x-radar-secret`), chamado pelo Worker (`POST /api/audio/resend`).
- **Fluxo:** `Auth + Parse` → `Get Row` (busca a linha em `radar_pe_audio_saves`) → `Prepara Reenvio` (guarda: não reenvia se já `salvo`; 404 se não existe) → chama o `09 - Download Áudio` → `Respond`.

### 11 — Notion List Pages (webhook)

- **Trigger:** Webhook `GET /radar-notion-list` (auth `x-radar-secret`), chamado pelo Worker (`GET /api/notion/query`).
- **Fluxo:** `Auth` (Code, valida o header) → `Get Pages` (Notion, `databasePage getAll` no database "Radar Mobiliza PE") → `Normalize` (Code: converte as propriedades cruas do Notion nas mesmas chaves do envio — `titulo`, `o_que_disse`, `area`, `status`...) → `Respond` (devolve `{ rows: [...] }`).
- **Usado pela:** aba "Radar Mobiliza PE" do front (espelho somente-leitura do database do Notion). O mesmo segredo do `07` é usado no `Auth` (o Worker autentica com o `N8N_NOTION_WEBHOOK_SECRET`).

## Modelo de dados (Supabase)

- **`radar_pe_instances`** — sessões (`name`, `category`, `connection_state`, `offline`). Seed manual.
- **`radar_pe_responsaveis`** — lista de responsáveis (gerenciável no front), usada pra atribuir nas sessões; `notion_user_id` guarda o id do usuário no workspace do Notion (p/ preencher a propriedade "people").
- **`radar_pe_chats`** — um por contato/conversa (`instance_name`, `remote_jid`, `contact_name`, `transcript`, `checkpoint`, ...). Único por `(instance_name, remote_jid)`.
- **`radar_pe_contacts`** — registro de negócio ("todos os contatos"), com os campos da Botando pra Moer.
- **`radar_pe_case_phrases`** — frases-gatilho do critério (1ª passagem), editável via SQL.
- **`radar_pe_cases`** — possíveis casos de Radar (1 contato → N casos): fragmento congelado (texto + `messages_snapshot` JSON) + aprovação do time.
- **`radar_pe_audio_triggers`** — combinações de emoji que disparam o salvamento de áudio, editável via SQL (seed: `🎙️📁`).
- **`radar_pe_audio_saves`** — auditoria dos áudios salvos no Drive (`pendente`/`salvo`/`erro`), idempotente por `(chat_id, trigger_msg_id)`.

### Por que o `radar_pe_chats` existe?

As mensagens cruas já vivem no banco da Evolution — o `radar_pe_chats` **não é uma cópia**, é uma camada derivada que guarda duas coisas que a Evolution não fornece:

1. **`transcript`** — texto renderizado ("Eu:"/"Contato:", `[áudio]`, `[imagem]`...). É uma transformação nossa do `message` (jsonb), pronta pro critério (Etapa 2) ler sem re-fazer o `CASE` a cada rodada.
2. **`checkpoint`** — cursor de sincronização ("até qual mensagem já processamos"). Estado nosso; a Evolution não guarda isso.

Três motivos pra mantê-lo:

- **Cursor incremental** — sem o checkpoint, o diário releria todo o histórico diariamente.
- **Critério desacoplado** — a Etapa 2 lê texto limpo, sem acoplar ao schema da Evolution.
- **Hedge de retention** — se a Evolution limpar/apagar mensagens antigas (ou uma sessão for deletada), o transcript é onde o contexto completo sobrevive.

Em resumo: **Evolution** = fonte da verdade · **`radar_pe_chats`** = cópia de trabalho (transcript + checkpoint) · **`radar_pe_contacts`** = registro de negócio (o que a equipe consulta/edita).

## Mapeamento Botando pra Moer → `radar_pe_contacts`

| Campo | Automatizável |
| --- | --- |
| Nome / Telefone / Contato inicial / Sessão | automático (preenchido só quando vazio; editável pelo time sem ser sobrescrito) |
| Comunidade / Município | cruzamento (futuro) |
| Temperatura / Teor / Responsável / Observação | humano (IA depois) |
| `temperatura_sugerida` / `last_message_from` | automático (sinais mecânicos; só leitura) |
| Status / Encaminhamento / `sent_to_radar` | critério (Etapa 2) |

> `radar_pe_contacts` é a tabela operacional (tipo CRM) que o time consulta/edita no front.
> A automação só preenche os campos automáticos e nunca sobrescreve edição humana; o
> `updated_at` só avança quando o time edita (trigger `radar_pe_contacts_touch`).

## Limitações conhecidas

- **Race de checkpoint (mesmo segundo):** o diário usa `messageTimestamp > checkpoint`. Se uma mensagem chegar no exato segundo do checkpoint (gravada após a leitura), pode ser pulada. Raríssimo e de baixo impacto.
- **`@lid` vs `@s.whatsapp.net`:** a mesma conversa pode aparecer sob dois jids (privacidade vs número), gerando duplicata. Resolvido: a captação canonicaliza via `key.remoteJidAlt` (CTE `lid_map`) e há o `radar_pe_merge_lid_duplicates()` pra unir os existentes. `@lid` sem número conhecido (privacidade total) segue `@lid` — não há dedup possível.
- **Campos menores:** `phone` de contato `@lid` guarda o lid (não o número); `last_activity_at` ainda não é preenchido; `first_message_at` fica impreciso em conversas com >10k mensagens (daria pra vir de `Contact.createdAt`).

## Setup

1. Rodar `schema.sql` no Supabase.
2. Seedar `radar_pe_instances` só com as sessões de PE (nome exato, com acento/espaço).
3. Em base com dados já capturados, rodar uma vez: `select radar_pe_backfill_signals();` e `select radar_pe_detect_cases();` (preenche sinais e casos do histórico).
4. Importar os JSONs do n8n (01 a 10).
5. Conectar credenciais: Postgres `admin evo` (nós `Find Chats`/`Find Messages`), Supabase (`Supabase account`), Evolution (health), Google Drive (no `09`), e selecionar os sub-workflows nos mains.
6. Front: `cd front && npm install`, depois `npm run dev:full` (build + Worker local) ou `npm run dev` (Vite) com `wrangler dev` rodando em paralelo. Para local, copiar `.env.example` → `.dev.vars` e preencher os segredos.

## Front (CRM básico)

- Vite + React + TS. O front fala com o Supabase **via Worker do Cloudflare** (`/api/db` faz proxy), nunca direto.
- Abas: **Contatos** (lista/edita `radar_pe_contacts`), **Sessões** (gerencia instâncias + responsáveis), **Casos pro Radar** (revisa e aprova/descarta possíveis casos; gerencia as frases-gatilho), **Áudios pra Campanha** (consulta o status dos áudios salvos, gerencia os emojis-gatilho e reenvia áudios com erro) e **Radar Mobiliza PE** (espelho somente-leitura do database "Radar Mobiliza PE" no Notion — clique na linha abre um drawer com os detalhes e um botão "Abrir no Notion").
- Lista `radar_pe_contacts` ordenada por `last_message_at` desc, com busca (nome/telefone), filtro por categoria, sessão, responsável e **filtro de período** (padrão: "Esta semana", segunda a hoje; também "Período completo" ou período personalizado por data) e edição inline de nome/telefone (o trigger `radar_pe_contacts_touch` bumpa `updated_at` na edição).
- **Auth:** senha única compartilhada (secret `APP_PASSWORD` no Cloudflare). O Worker checa a senha, emite cookie assinado (`AUTH_SECRET`) e só libera os dados para sessão válida. A service role key fica **só no Worker**, nunca no bundle.
- **Encaminhamento pro Notion (Etapa 3):** aprovar um caso abre um form pré-preenchido (13 campos, espelhando o form atual) que, ao ser submetido, é enviado pelo Worker ao webhook do n8n (`POST /api/notion/pages` → `07 - Notion Create Page`). O n8n cria a página no database do Notion (com a credencial do node Notion) e devolve o `page_id`; o front marca o caso como `enviado` (salva o payload em `radar_pe_cases.encaminhamento`).
- **Reenvio de áudio:** na aba "Áudios pra Campanha", o botão **Reenviar** chama `POST /api/audio/resend` → o Worker repassa pro webhook `10 - Reenviar Áudio` → o `09` baixa da Evolution e sobe no Drive de novo.

## Deploy (Cloudflare Workers)

```bash
cd front
npm run build
wrangler secret put APP_PASSWORD               # senha de acesso (interativo)
wrangler secret put AUTH_SECRET                # ex.: openssl rand -base64 32
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put N8N_NOTION_WEBHOOK_URL     # URL do webhook "07 - Notion Create Page"
wrangler secret put N8N_NOTION_WEBHOOK_SECRET  # mesmo segredo configurado no Code do 07
wrangler secret put N8N_NOTION_LIST_WEBHOOK_URL  # URL do webhook "11 - Notion List Pages"
wrangler secret put N8N_NOTION_USERS_WEBHOOK_URL  # URL do webhook "12 - Notion List Users"
wrangler secret put N8N_AUDIO_RESEND_WEBHOOK_URL     # URL do webhook "10 - Reenviar Áudio"
wrangler secret put N8N_AUDIO_RESEND_WEBHOOK_SECRET  # mesmo segredo configurado no Code do 10
wrangler secret put N8N_ANALISE_WEBHOOK_URL          # https://webhookn8n.tnledu.shop/webhook/analise-missao-csv
wrangler secret put N8N_ANALISE_WEBHOOK_SECRET       # mesmo secret do staticData do fluxo de análise
wrangler secret put ANALISES_BUCKET                  # bucket privado de XLSX de análise (ex.: analises-missoes)
wrangler deploy
```

- `SUPABASE_URL` fica em `vars` no `wrangler.jsonc`.
- **Login persistente:** o cookie dura 1 ano (teto do browser) e a sessão só expira ao rotacionar o `AUTH_SECRET`. Para trocar a senha (e derrubar todo mundo): `wrangler secret put APP_PASSWORD` **e** `wrangler secret put AUTH_SECRET`.

## Setup Notion (Etapa 3)

A criação da página no Notion é feita pelo **n8n** (que já tem a credencial do node Notion configurada) — o Worker só repassa o form. As propriedades abaixo devem existir no database "Radar Mobiliza PE" **com os mesmos nomes** (o mapeamento fica no node "Create Page" do `07 - Notion Create Page` — ajuste lá se os nomes divergirem):

| Propriedade | Tipo Notion |
| --- | --- |
| Título | Title |
| O que a pessoa disse | Text |
| Área | Select |
| Precisa de retorno | Select (Sim/Não) |
| Responsável pelo contato | People (usuário do workspace) |
| Pessoa | Text |
| Telefone | Phone |
| Data | Date |
| Urgência | Select |
| O que a gente fez | Text |
| Status | Status (ou Select) |
| Fonte | Select |
| Cidade | Relation (página do município na database "Cidade x Macrorregião") |
| Macrorregião | Rollup automático sobre a relation "Cidade" (não é enviado) |
| Sessão responsável pelo contato | Text |

> As opções dos selects (Área, Urgência, Fonte, Status) são livres — o form do front já envia os valores corretos; o Notion cria as opções automaticamente na primeira página.
>
> **Cidade é Relation.** O form envia `cidade_page_id` (o id da página do município); o node "Create Page" do `07` grava a relation. A lista de municípios do select do front vem do snapshot estático em `front/src/lib/cidadesRadar.ts` (páginas da database "Cidade x Macrorregião"), que inclui nome + page id + Macrorregião. O campo "Fonte" já vem com **"Comunidade regional"** selecionado por padrão (mas é alterável).
>
> **Macrorregião é um Rollup** (`show_original`) sobre a relation "Cidade" no Notion — preenche sozinha quando a Cidade é definida. O front apenas exibe a Macrorregião da cidade escolhida (somente leitura); o payload não envia esse campo pro Notion.
>
> **Atenção:** a criação/edição de propriedades no database do Notion é **manual** (time). O campo "Sessão responsável pelo contato" só deve ser enviado depois que a propriedade existir no Notion — até lá, o `07` ignora o campo sem quebrar. O JSON `07_notion_create_page.json` deste repo pode estar defasado em relação ao workflow vivo no editor (mantido manualmente); **a referência é o workflow vivo**. O fluxo do `07` hoje monta o body cru da API do Notion (`POST /v1/pages`) num node Code e envia via HTTP Request com a credencial Notion — ajuste o mapeamento em **"Montar Payload Notion"** e/ou no **"Auth + Normalize"** se os nomes divergirem.

Passos no n8n:

1. Importar o `07_notion_create_page.json`.
2. No node **Montar Payload Notion**: substituir `SELECIONE_DATABASE_NOTION` pelo id do database "Radar Mobiliza PE" (ex.: `5c501c99-7054-44a8-84b9-e4cfb4dbc1b8`).
3. No node **Criar Página no Notion**: selecionar a **credencial do Notion** já existente (placeholder `SELECIONE_CREDENCIAL_NOTION`).
4. No node **Auth + Normalize**: trocar `TROQUE_PELO_SEGREDO` por um segredo forte (ex.: `openssl rand -hex 32`) — e usar o **mesmo valor** no `N8N_NOTION_WEBHOOK_SECRET` do Worker.
5. Ativar o workflow e copiar a **URL do webhook** (Production) pro `N8N_NOTION_WEBHOOK_URL` do Worker.

### Setup do espelho (11 - Notion List Pages)

1. Importar o `11_notion_list.json`.
2. No node **Get Pages**: selecionar a mesma **credencial do Notion** e o **database** "Radar Mobiliza PE" (placeholders `SELECIONE_DATABASE_NOTION` / `SELECIONE_CREDENCIAL_NOTION`).
3. No node **Auth**: usar o **mesmo segredo** do `07` (`TROQUE_PELO_SEGREDO`) — o Worker autentica com o `N8N_NOTION_WEBHOOK_SECRET` já configurado.
4. Ativar o workflow (a URL de produção só registra o webhook ao ativar pelo **toggle no editor** — ativar via API não registra o path) e copiar a **URL do webhook** (Production, `https://webhookn8n.tnledu.shop/webhook/radar-notion-list`) pro `N8N_NOTION_LIST_WEBHOOK_URL` do Worker.

### Setup da lista de usuários (12 - Notion List Users)

1. Importar o `12_notion_list_users.json`.
2. No node **Get Users**: selecionar a mesma **credencial do Notion** (`SELECIONE_CREDENCIAL_NOTION`).
3. No node **Auth**: usar o **mesmo segredo** do `07` (`TROQUE_PELO_SEGREDO`).
4. Ativar (se criar via API, o path só registra após um toggle no editor ou com `webhookId` setado no node) e copiar a **URL do webhook** (Production, `https://webhookn8n.tnledu.shop/webhook/radar-notion-users`) pro `N8N_NOTION_USERS_WEBHOOK_URL` do Worker.

> **Atenção:** a integração do Notion no n8n só lista os usuários que a API `GET /users` devolve pra ela — normalmente só quem compartilhou algo com a integração. Pra listar o workspace inteiro é preciso habilitar **"Read user information"** na integração (ou criar uma integração nova com essa permissão e trocar o token no n8n). Sem isso, o picker de responsáveis no front mostra poucos usuários.

## Setup Áudio → Google Drive

O salvamento de áudio roda no n8n (workflow `08` → `09`) e é acionado pelo `06` quando o operador responde a um áudio com uma mensagem contendo um dos emojis cadastrados em `radar_pe_audio_triggers` (seed: `🎙️📁`).

Passos no n8n:

1. Importar o `08_salvar_audio.json`, `09_download_audio.json` e `10_reenviar_audio.json` (e o `06_radar_mensagem.json`, que já traz o nó `Salvar Áudio (08)`).
2. No `09`, no node **Google Drive Upload**: selecionar a **credencial Google (OAuth)** já existente (substituir o placeholder `SELECIONE_CREDENCIAL_GOOGLE_DRIVE`). A pasta de destino já está preenchida (`1zRE-ZiyvfWO60sj4lwRZefX-vkZvWe7v`) — ajuste se quiser outra.
3. Selecionar o sub-workflow **09 - Download Áudio** nos nós `Download Áudio (09)` do `08` e do `10`.
4. No `10`, no node **Auth + Parse**: trocar `TROQUE_PELO_SEGREDO` por um segredo forte (ex.: `openssl rand -hex 32`) — e usar o **mesmo valor** no `N8N_AUDIO_RESEND_WEBHOOK_SECRET` do Worker. Ativar o `10` e copiar a **URL do webhook** (Production) pro `N8N_AUDIO_RESEND_WEBHOOK_URL`.
5. Ajustar os emojis (via SQL ou pela aba "Áudios pra Campanha") se quiser trocar o gatilho:

```sql
insert into radar_pe_audio_triggers (emoji) values ('🔊📥')
on conflict (emoji) do nothing;
-- desativar o padrão: update radar_pe_audio_triggers set active = false where emoji = '🎙️📁';
```

> A Evolution devolve o áudio em base64 (o `To Binary` lê `base64` no topo ou em `media.base64`, e remove o prefixo `data:...;base64,`). Contatos `@lid` sem número podem não localizar a mídia — nesses casos o log fica como `erro` em `radar_pe_audio_saves`, e o time pode **Reenviar** pela aba do front.

## Missões (captura do grupo de coordenação)

A aba **"Missões"** do front mostra os links de missão que um remetente (ex.: Eryck) posta num grupo de coordenação. O fluxo `13 - Vigia Missões PE` lê o Postgres da Evolution a cada minuto, resolve o link (Instagram direto ou encurtador `engaja.pro`) e grava a candidata em `radar_pe_missoes_capturadas`. No front, o operador clica **Gerar**: o Worker (`POST /api/missoes/gerar`) encurta o link em `engaja.pro`, cria a missão em `central_engajamento.missoes` (sem Notion), dispara a evolução de métricas e devolve o texto pronto para **copiar** e mandar de volta no grupo.

- **Fontes monitoradas** ficam em `radar_pe_mission_sources` (instância, grupo, remetente, checkpoint). Trocar de instância/grupo é editar a linha — o vigia lê a config da tabela, não hardcoded.
- **Idempotência**: captura por `msg_id` (`unique`); geração por `link`/`titulo` (não duplica missão do mesmo post).
- **Status da candidata**: `nova → gerada` (ou `descartada`/`erro`). Candidatas com erro podem ser tentadas de novo.
- **Métricas**: o drawer da captura lê `central_engajamento.missoes` (`metricas_evolucao`/`cliques`) — por isso o proxy do Worker repassa `Accept-Profile`/`Content-Profile`.

### Missões geradas + Análise

Abaixo das capturas, a mesma aba lista as **missões geradas** (`central_engajamento.missoes`, projeto PE, `ativa=true`): criado em, título, link encurtado, cliques, status (Analisada/Pendente) e o botão **Analisar**. O Analisar abre um dialog que recebe o **XLSX do ExportComments** e dispara o fluxo de análise do n8n:

```
Front (dialog) → POST /api/missoes/analisar (Worker)
  → upload no Supabase Storage (bucket privado `analises-missoes`) + URL assinada (1h)
  → POST webhook n8n /analise-missao-csv  { titulo_missao, base_codigo, xlsx_url }
  → fluxo "[Transição] Análise de Engajamento" (GPuP5fmLlAZhHOp5)
     Mapeamento (CSV) → Checa Missão → ... → XLSX→JSON → cruzamento → upsert missão + Notion
```

O ponto de entrada é um **webhook novo no mesmo fluxo de análise** (`POST /analise-missao-csv`, autenticado por `x-radar-secret`). O node `Mapeamento Tally1` foi trocado por um Code que aceita **Tally** (comportamento original preservado) **ou** o payload do CSV. A planilha de mobilizadores é fixa (PE) e o arquivo é **XLSX** (o nó de parse espera XLSX com cabeçalho na linha 6).

### Setup

1. Rodar a seção **"12. Missões"** do `schema.sql` no Supabase (cria `radar_pe_mission_sources`, `radar_pe_missoes_capturadas` e as RPCs; já semeia a fonte do grupo `[coord] Mobiliza PE`).
2. Importar o `n8n/13_vigia_missoes.json` e, no **staticData** do workflow, preencher `vinculoToken` (Bearer do `vinculo.pro`, mesmo token usado no fluxo "Vigia Jamilly"). Ativar.
3. No Worker, definir os secrets:
   - `VINCULO_TOKEN` (token do `vinculo.pro`).
   - `N8N_ANALISE_WEBHOOK_URL` = `https://webhookn8n.tnledu.shop/webhook/analise-missao-csv`.
   - `N8N_ANALISE_WEBHOOK_SECRET` (mesmo `secret` no staticData do fluxo de análise).
   - `ANALISES_BUCKET` = `analises-missoes`.
4. Criar o bucket **privado** `analises-missoes` no Supabase Storage.

> O vigia usa a sessão Evolution **`CENTRAL DE ENGAJAMENTO`** (fonte em `radar_pe_mission_sources`, que precisa estar no grupo). Para trocar de sessão, edite/ative a linha da fonte — o vigia lê a tabela, não o workflow.

## Roadmap

- [X] Etapa 1 — captação (backfill + diário + health)
- [ ] Etapa 1 (otimização p/ produção) — diário em bulk por instância + skip de inativos; índice no `findChats`
- [X] Etapa 2a — registro mecânico em `radar_pe_contacts` (upsert via `radar_pe_upsert_chat` + `radar_pe_backfill_contacts`)
- [X] Etapa 2b (sinais mecânicos) — `last_message_from` + `temperatura_sugerida` (score determinístico + decay)
- [X] Etapa 2b (casos) — critério fraseado + `radar_pe_cases` + aprovação no front (aba "Casos")
- [X] Etapa 2b (tempo real) — webhook global + `radar_pe_append_message` (SLA de segundos)
- [ ] Etapa 2b (critério fino) — status/encaminhamento/`sent_to_radar` (com a Maíra)
- [X] Etapa 3 — alimentar Radar Mobiliza PE (Notion) — aprovar abre form pré-preenchido → envia pro database
- [X] Áudio → Drive — operador responde com emoji-gatilho e o último áudio do contato sobe pro Google Drive (workflows 08 → 09; aba "Áudios pra Campanha" com status + reenvio via 10)
- [ ] Calibração (2–3 rodadas) + trocar frase do painel de campo
