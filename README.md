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

| Arquivo                            | O que é                                                                |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `schema.sql`                     | Tabelas`radar_pe_*` + funções RPC (rodar no SQL Editor do Supabase) |
| `n8n/01_backfill_instancia.json` | Sub: captura o histórico completo de UMA instância                    |
| `n8n/02_backfill_main.json`      | Main: disparo manual → lista instâncias → chama 01                   |
| `n8n/03_diario_instancia.json`   | Sub: captura incremental (só mensagens novas) de UMA instância        |
| `n8n/04_diario_main.json`        | Main: cron diário → lista instâncias → chama 03                     |
| `n8n/05_health.json`             | Cron diário: checa`connectionState` e marca sessões offline         |
| `queries_validacao.md`           | Queries pra conferir o resultado do backfill                            |

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

## Modelo de dados (Supabase)

- **`radar_pe_instances`** — sessões (`name`, `category`, `connection_state`, `offline`). Seed manual.
- **`radar_pe_chats`** — um por contato/conversa (`instance_name`, `remote_jid`, `contact_name`, `transcript`, `checkpoint`, ...). Único por `(instance_name, remote_jid)`.
- **`radar_pe_contacts`** — registro de negócio ("todos os contatos"), com os campos da Botando pra Moer.

## Mapeamento Botando pra Moer → `radar_pe_contacts`

| Campo                                            | Automatizável      |
| ------------------------------------------------ | ------------------- |
| Nome / Telefone / Contato inicial / Sessão      | automático         |
| Comunidade / Município                          | cruzamento (futuro) |
| Temperatura / Teor / Responsável / Observação | humano (IA depois)  |
| Status / Encaminhamento /`sent_to_radar`       | critério (Etapa 2) |

## Setup

1. Rodar `schema.sql` no Supabase.
2. Seedar `radar_pe_instances` só com as sessões de PE (nome exato, com acento/espaço).
3. Importar os 5 JSONs no n8n.
4. Conectar credenciais: Postgres `admin evo` (nós `Find Chats`/`Find Messages`), Supabase (`Supabase account`), Evolution (health), e selecionar os sub-workflows nos mains.

## Roadmap

- [X] Etapa 1 — captação (backfill + diário + health)
- [ ] Etapa 2 — registro em `radar_pe_contacts` + critério (com a Maíra)
- [ ] Etapa 3 — alimentar Radar Mobiliza PE (Notion)
- [ ] Calibração (2–3 rodadas) + trocar frase do painel de campo
