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
Evolution (Postgres, cred "admin evo")  ──►  n8n  ──►  Supabase (radar_pe_*)  ──►  (futuro) Notion Radar
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

## Modelo de dados (Supabase)

- **`radar_pe_instances`** — sessões (`name`, `category`, `connection_state`, `offline`). Seed manual.
- **`radar_pe_responsaveis`** — lista de responsáveis (gerenciável no front), usada pra atribuir nas sessões.
- **`radar_pe_chats`** — um por contato/conversa (`instance_name`, `remote_jid`, `contact_name`, `transcript`, `checkpoint`, ...). Único por `(instance_name, remote_jid)`.
- **`radar_pe_contacts`** — registro de negócio ("todos os contatos"), com os campos da Botando pra Moer.
- **`radar_pe_case_phrases`** — frases-gatilho do critério (1ª passagem), editável via SQL.
- **`radar_pe_cases`** — possíveis casos de Radar (1 contato → N casos): fragmento congelado + aprovação do time.

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
4. Importar os 5 JSONs no n8n.
5. Conectar credenciais: Postgres `admin evo` (nós `Find Chats`/`Find Messages`), Supabase (`Supabase account`), Evolution (health), e selecionar os sub-workflows nos mains.
6. Front: `cd front && npm install`, depois `npm run dev:full` (build + Worker local) ou `npm run dev` (Vite) com `wrangler dev` rodando em paralelo. Para local, copiar `.env.example` → `.dev.vars` e preencher os segredos.

## Front (CRM básico)

- Vite + React + TS. O front fala com o Supabase **via Worker do Cloudflare** (`/api/db` faz proxy), nunca direto.
- Abas: **Contatos** (lista/edita `radar_pe_contacts`), **Sessões** (gerencia instâncias + responsáveis) e **Casos pro Radar** (revisa e aprova/descarta possíveis casos; gerencia as frases-gatilho).
- Lista `radar_pe_contacts` ordenada por `last_message_at` desc, com busca (nome/telefone), filtro por categoria e edição inline de nome/telefone (o trigger `radar_pe_contacts_touch` bumpa `updated_at` na edição).
- **Auth:** senha única compartilhada (secret `APP_PASSWORD` no Cloudflare). O Worker checa a senha, emite cookie assinado (`AUTH_SECRET`) e só libera os dados para sessão válida. A service role key fica **só no Worker**, nunca no bundle.

## Deploy (Cloudflare Workers)

```bash
cd front
npm run build
wrangler secret put APP_PASSWORD               # senha de acesso (interativo)
wrangler secret put AUTH_SECRET                # ex.: openssl rand -base64 32
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler deploy
```

- `SUPABASE_URL` fica em `vars` no `wrangler.jsonc`.
- **Login persistente:** o cookie dura 1 ano (teto do browser) e a sessão só expira ao rotacionar o `AUTH_SECRET`. Para trocar a senha (e derrubar todo mundo): `wrangler secret put APP_PASSWORD` **e** `wrangler secret put AUTH_SECRET`.

## Roadmap

- [X] Etapa 1 — captação (backfill + diário + health)
- [ ] Etapa 1 (otimização p/ produção) — diário em bulk por instância + skip de inativos; índice no `findChats`
- [X] Etapa 2a — registro mecânico em `radar_pe_contacts` (upsert via `radar_pe_upsert_chat` + `radar_pe_backfill_contacts`)
- [X] Etapa 2b (sinais mecânicos) — `last_message_from` + `temperatura_sugerida` (score determinístico + decay)
- [X] Etapa 2b (casos) — critério fraseado + `radar_pe_cases` + aprovação no front (aba "Casos")
- [X] Etapa 2b (tempo real) — webhook global + `radar_pe_append_message` (SLA de segundos)
- [ ] Etapa 2b (critério fino) — status/encaminhamento/`sent_to_radar` (com a Maíra)
- [ ] Etapa 3 — alimentar Radar Mobiliza PE (Notion)
- [ ] Calibração (2–3 rodadas) + trocar frase do painel de campo
