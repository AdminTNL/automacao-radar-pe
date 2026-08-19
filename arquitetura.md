# Arquitetura — Radar Mobiliza PE

Documento de referência do desenho técnico do projeto, pra alinhamento interno e com o time.
Consolida o que já está implementado (Etapas 1 e 2a) e o desenho proposto para as Etapas 2b/3.

## Estado atual

| Etapa | Status |
| --- | --- |
| 1 — captação (backfill + diário + health) | ✅ feito |
| 2a — registro mecânico em `radar_pe_contacts` | ✅ feito |
| 2b — sinais mecânicos (`last_message_from` + `temperatura_sugerida`) | ✅ feito (score determinístico + decay, calibrável) |
| 2b — casos (`radar_pe_cases`: critério fraseado + aprovação no front) | ✅ feito (1ª passagem) |
| 2b — tempo real (webhook global + `radar_pe_append_message`) | ✅ feito |
| 2b — critério fino refinado (status / encaminhamento / Maíra) | ⏳ desenho abaixo |
| 3 — alimentar Radar Mobiliza PE (Notion) | ⏳ desenho abaixo |

## Visão geral

```
Evolution (Postgres) ──► n8n ──► Supabase (radar_pe_*) ──► (futuro) Notion Radar
                                        │
                                        └─► Front (Botando pra Moer): contatos, sessões, conversas
```

- **Evolution** = fonte da verdade (mensagens cruas).
- **`radar_pe_chats`** = cópia de trabalho (transcript + checkpoint + mensagens).
- **`radar_pe_contacts`** = registro operacional/CRM (o que o time consulta e edita).
- **`radar_pe_cases`** = só casos de Radar (fragmento congelado + dispatch).

## Princípios de desenho

1. **Caso ≠ conversa.** Uma conversa pode gerar vários casos de Radar ao longo do tempo. Um caso, uma vez identificado, é **congelado** e nunca é sobrescrito pelo desenrolar da conversa.
2. **Identidade vs. estado.** Contato é identidade (pessoa/sessão); caso é artefato de Radar.
3. **Automação não sobrescreve o time.** Campos mantidos pelo time nunca são clobberados; a automação só sugere. (`updated_at` só avança em edição humana — trigger com sentinel `radar_pe.is_auto`.)
4. **Nome/telefone são do sistema.** Refletem o WhatsApp (system wins); editáveis no front apenas quando vazios.

## Modelo de dados

### `radar_pe_instances` — sessões da Evolution
`name` (PK, exato), `category`, `responsavel` (novo), `connection_state`, `last_activity_at`, `last_sync_at`, `offline`.

O `responsavel` da sessão preenche dinamicamente o "responsável" exibido nos contatos (join no front; o `responsavel` do contato serve de override futuro).

### `radar_pe_responsaveis` — lista de responsáveis (gerenciável)
`name` (PK). Populada pelo time no front (botão "Cadastrar responsável"); alimenta os selects de atribuição de responsável nas sessões.

### `radar_pe_chats` — camada de captação (1 por conversa)
`id`, `instance_name`, `remote_jid`, `contact_name`, `phone`, `first_message_at`, `last_message_at`, `checkpoint`, `transcript`.

**Implementado:**

- `messages jsonb` — array `[{ts, from_me, body, msg_id}]`. Base pro agrupamento por dia e pros timestamps no drawer.

**Proposto:**

- `criterion_checkpoint timestamptz` — cursor até onde o critério já avaliou (impede reavaliar/sobrescrever).

### `radar_pe_contacts` — registro operacional (1 por conversa)
`chat_id` (not null, único), `instance_name`, `remote_jid`, `contact_name`, `phone`, `first_message_at`, `last_message_at`, `origem`, `comunidade`, `municipio`, `temperatura`, `teor_da_conversa`, `responsavel`, `status`, `encaminhamento`, `observacao`, `sent_to_radar`, `created_at`, `updated_at`.

**Implementado:**

- `last_message_from` (`'me' | 'contact' | null`) — sinal mecânico "quem falou por último" (alimenta status/aguardando resposta).
- `temperatura_sugerida` (`'frio' | 'morno' | 'quente' | 'esfriou'`) — sugestão automática, só leitura no front. O `temperatura` é do time.

### `radar_pe_case_phrases` — frases-gatilho (critério 1ª passagem)
`id`, `phrase` (única), `active`, `created_at`. Seed com as frases de "encaminhamento/compromisso" (ex.: "Obrigado por compartilhar", "Vou verificar", "Vou levar esse tema"). Editável pela equipe via SQL sem redeploy. Segue útil mesmo quando a IA assumir o critério — vira sinal de entrada/rótulo explicável.

### `radar_pe_cases` — casos de Radar (1 contato → N casos)
`id`, `chat_id`, `contact_id`, `instance_name`, `remote_jid`, `contact_name`, `phone`, `trigger_msg_id`, `matched_phrase`, `fragment_start_at`, `fragment_end_at`, `transcript_snapshot`, `temperatura_snapshot`, `status` (`pendente`/`aprovado`/`descartado`/`enviado`), `sent_to_radar`, `notion_page_id`, `sent_at`, `created_at`, `updated_at`. `unique(chat_id, trigger_msg_id)` = idempotência.

- **Detecção** (`radar_pe_detect_cases_for_chat`/`radar_pe_detect_cases`): mensagem **nossa** cujo body contém uma frase ativa → abre caso `pendente`, congelando as últimas N mensagens + o gatilho. Roda no fim de `radar_pe_upsert_chat` (sempre fresca); o bulk cobre o histórico.
- **Aprovação** (front, aba "Casos pro Radar"): o time lê o `transcript_snapshot` congelado e aprova/descarta; a aba também permite adicionar/editar/desativar as frases-gatilho. `updated_at` só avança em edição humana (trigger espelhando o de contatos).
- Cada caso congela um trecho no momento da identificação; conversa continuar ⇒ novos casos, nunca reescrever o antigo. `trigger_msg_id` registra qual mensagem disparou.

## Temperatura (do contato)

Definida como **info geral do contato**, mantida pelo time, com sugestão automática:

| Temperatura | Definição (notas da reunião) |
| --- | --- |
| Frio | central manda mensagem, pessoa não responde |
| Morno | central manda, pessoa responde sem puxar assunto |
| Quente | central manda, pessoa responde, usa mídia etc. |
| Esfriou | respondeu, mas parou/tempo passou (antes morno/quente que decaiu) |

- Automação calcula `temperatura_sugerida` a partir de sinais mecânicos (respondeu?, mídia?, perguntas?, vai-e-vem, tamanho do texto, recência).
- O time confirma/ajusta o `temperatura` no front (dono do valor).

### Regra mecânica (score determinístico, calibrável)

Sinais derivados de `radar_pe_chats.messages` (SQL puro, sem re-backfill):

| Sinal | Definição |
| --- | --- |
| `last_message_from` | `from_me` da última mensagem (`'me' | 'contact' | null`) |
| `n_contact` | nº de mensagens do contato (`from_me = false`) |
| `n_contact_media` | nº de mensagens do contato com token de mídia (`[audio]`, `[imagem]`, `[video]`, `[figurinha]`, `[documento]`, `[localizacao]`) |
| `n_contact_q` | nº de mensagens do contato com `?` (puxa assunto) |
| `n_contact_text` / `sum_contact_len` | nº / soma de caracteres das mensagens de texto do contato (fora mídia) |
| `n_turns` | alternâncias `me`↔`contato` (vai-e-vem) |
| `last_contact_at` | `ts` da última mensagem do contato (base do decay) |

```
engajamento = 1×min(n_contact,5) + 3×n_contact_media + 2×n_contact_q
              + 1×min(n_turns,5) + 1×min(avg_len/40, 3)

decay (dias desde a última msg do contato):
  <=3=1.0 · <=7=0.7 · <=14=0.5 · <=30=0.3 · mais=0.15

score = engajamento × decay

frio    = n_contact = 0          (central falou, ninguém respondeu)
quente  = score >= 6
esfriou = n_contact > 0 E score < 2   (respondeu, mas parou/tempo passou)
morno   = senão
null    = chat sem messages
```

- **Recência agora entra** via `decay`, produzindo o rótulo `esfriou` em vez de rebaixar pra `frio` (que fica reservado a "nunca respondeu"). `last_message_at` segue ordenando o dash e `last_message_from` segue indicando "aguardando resposta".
- **Limite conhecido:** mídia com legenda escapa (a captação não guarda o `type` do `message`); melhoria futura = gravar `type` no `messages` (re-backfill).
- **Calibração:** os pesos, o decay e os limiares (ex.: `quente >= 6`) são a ser validados com a Maíra contra a referência dos 15 casos.

## Pipeline de identificação de caso (Etapa 2b → 3)

```
captação (mensagens jsonb)
  → sinais mecânicos (último remetente, respondeu?, mídia?, nº msgs)
  → temperatura_sugerida (frio/morno/quente)
  → critério fraseado (radar_pe_case_phrases) → abre radar_pe_cases 'pendente' (congela fragmento)
  → aprovação do time (front) → 'aprovado' / 'descartado'
  → dispatch Notion (Etapa 3) → 'enviado' / sent_to_radar = true
```

- **Camada mecânica** (determinística): derivada do `messages`, sempre fresca. ✅
- **Critério fraseado** (1ª passagem): abre casos a partir das frases-gatilho. ✅ (substitui temporariamente o julgamento fino)
- **Camada fina** (julgamento): critério da Maíra, depois assistida por IA. ⏳
- **Calibração**: bater perto dos **15** casos da semana 11–14/08 (referência "Botando pra Moer").

## Frequência e gatilhos

- **Diário** (cron 8h): captação incremental em batch. Fica como **reconciliação/rede de segurança** do tempo real.
- **Tempo real** (webhook global da Evolution): `messages.upsert` chega em segundos em `https://webhookn8n.tnledu.shop/webhook/evolution-connection` (fluxo global do n8n), que chama o `06 - Radar Mensagem` → RPC `radar_pe_append_message` (append de 1 mensagem + sinais + detecção). Gatekeeper: só sessões de `radar_pe_instances`.
- **Trigger de resposta**: a resposta do operador (`fromMe=true`) é o que dispara a detecção de caso — a detecção roda quando a mensagem nossa chega (a `radar_pe_append_message` só chama detecção quando `from_me`).

## Custos/notas de implementação

- **`messages jsonb`**: a captação (n8n) já tem `ts/from_me/body/msg_id` por mensagem — guardar o array é mudança pequena no `Build Transcript`/`Merge` + parâmetro `p_messages` no upsert.
- **Append incremental**: movido pro SQL (RPC `radar_pe_append_message`) — usado pelo webhook "ao vivo" pra não transportar o array inteiro. ✅
- **Histórico**: chats já capturados não têm timestamp por mensagem no transcript → **re-backfill** (re-ler a Evolution e reconstruir `transcript` + `messages`). Único e pesado.

## Dedup `@lid` vs `@s.whatsapp.net` (implementado)

**Problema:** a mesma conversa pode aparecer sob dois jids na Evolution — `@lid` (privacidade) e `@s.whatsapp.net` (número). Uma mensagem tem `key.remoteJid = @lid` **e** `key.remoteJidAlt = @s.whatsapp.net`; como o `Find Chats` agrupava por `COALESCE(remoteJidAlt, remoteJid)`, mensagens `@lid` sem `alt` viravam um chat separado → contato duplicado.

**Aprendizados (dados reais):**

- A tabela `Contact` da Evolution **não** tem coluna de número; `Contact.id` é um cuid opaco (não é o LID) e `Contact.remoteJid` guarda o jid como veio (`@lid` ou número). **Não serve** de mapa `lid → número`.
- A única fonte confiável do mapa é `Message.key->>'remoteJidAlt'`. `@lid` sem `alt` em nenhuma mensagem = privacidade total (sem número) → não dá pra deduplicar (e nem há duplicata).
- `msg_id` **não é único entre instâncias** → sempre filtrar por `instance_name` no mapa e no merge.

**Solução:**

- **Canonicalização na captação (n8n 01/03):** CTE `lid_map` (lid → número, via `remoteJidAlt`, por instância) + `COALESCE` que resolve `@lid` pro número quando conhecido; `Find Messages` busca pelos dois jids via CTE `aliases`.
- **Merge dos existentes:** `radar_pe_merge_lid_duplicates()` une chats da mesma instância que compartilham `msg_id` (mensagens + transcript regenerado), mantém o número como canônico, une contatos e apaga o `@lid`. Idempotente.
- **Limpeza de órfãos:** `radar_pe_cleanup_orphan_lids()` apaga chats `@lid` **sem `messages`** (linha órfã da captação pré-canonicalização, cujo dado já migrou pro número), pulando contatos com edição manual. Idempotente. Como a canonicalização impede novos splits, não há novos órfãos — é limpeza única.

## Pontos em aberto

1. **Quem abre o caso**: resolvido — a ferramenta cria `pendente` e o time aprova/descarta no front (aba "Casos pro Radar").
2. **`sent_to_radar`**: fica só no caso, ou também um flag no contato pra ordenar/filtrar o dash?
3. **Mapeamento sinais → temperatura**: 1ª passagem implementada (ver "Regra mecânica"); falta validar/ajustar os limiares com a Maíra.
4. **O que congela no snapshot** além do transcript (ex.: cópia de temperatura/encaminhamento no momento).
