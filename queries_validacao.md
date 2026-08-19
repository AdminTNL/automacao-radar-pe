# Queries de validação pós-backfill

Rodar no SQL Editor do Supabase (salvo quando indicado).

## 1. Total de chats capturados

```sql
SELECT count(*) AS total_chats FROM radar_pe_chats;
```

## 2. Por instância (todas captaram? tem transcript vazio?)

```sql
SELECT instance_name,
       count(*) AS chats,
       count(*) FILTER (WHERE transcript IS NULL OR transcript = '') AS sem_transcript
FROM radar_pe_chats
GROUP BY instance_name
ORDER BY chats DESC;
```

Esperado: nenhuma instância relevante zerada, e pouco `sem_transcript`.

## 3. Amostra de transcripts (qualidade do texto)

```sql
SELECT instance_name, remote_jid, contact_name,
       left(transcript, 200) AS amostra,
       first_message_at, last_message_at
FROM radar_pe_chats
ORDER BY last_message_at DESC
LIMIT 20;
```

Esperado: `amostra` com texto legível ("Eu:" / "Contato:").

## 4. Checkpoint preenchido (o diário vai incrementar certo)

```sql
SELECT count(*) FILTER (WHERE checkpoint IS NOT NULL) AS com_checkpoint,
       count(*) FILTER (WHERE checkpoint IS NULL) AS sem_checkpoint
FROM radar_pe_chats;
```

Esperado: quase tudo com checkpoint.

## 5. Sanity check de ordem de grandeza (rodar no Postgres da Evolution)

Compara com o que capturamos. Rode no nó Postgres com a credencial `admin evo`:

```sql
SELECT count(DISTINCT m.key->>'remoteJid') AS chats_1a1_evo
FROM "Message" m
JOIN "Instance" i ON i."id" = m."instanceId"
WHERE m.key->>'remoteJid' LIKE '%@s.whatsapp.net';
```

Esperado: query 1 (~capturado) próximo do `chats_1a1_evo`.

## 6. Health das sessões

```sql
SELECT name, category, connection_state, offline, last_sync_at
FROM radar_pe_instances
ORDER BY name;
```

Esperado: `offline = false` nas sessões ativas; `true` nas caídas.

---

# Etapa 2 — registro de contatos (`radar_pe_contacts`)

Rodar após aplicar o `schema.sql` + `select radar_pe_backfill_contacts();`.

## 7. Contatos vs chats (deve ser 1:1)

```sql
SELECT
  (SELECT count(*) FROM radar_pe_chats) AS chats,
  (SELECT count(*) FROM radar_pe_contacts) AS contatos,
  (SELECT count(*) FROM radar_pe_chats c
    LEFT JOIN radar_pe_contacts k ON k.chat_id = c.id
    WHERE k.id IS NULL) AS chats_sem_contato;
```

Esperado: `chats = contatos` e `chats_sem_contato = 0`.

## 8. Campos automáticos preenchidos

```sql
SELECT
  count(*) FILTER (WHERE chat_id IS NULL)      AS sem_chat_id,
  count(*) FILTER (WHERE instance_name IS NULL) AS sem_instance,
  count(*) FILTER (WHERE remote_jid IS NULL)    AS sem_jid,
  count(*) FILTER (WHERE last_message_at IS NULL) AS sem_last_message
FROM radar_pe_contacts;
```

Esperado: `0` em tudo (`contact_name`/`phone` podem ser nulos p/ contatos sem nome resolvido ou `@lid`).

## 9. Campos humanos/critério intocados

```sql
SELECT
  count(*) FILTER (WHERE origem IS NOT NULL)           AS origem,
  count(*) FILTER (WHERE comunidade IS NOT NULL)       AS comunidade,
  count(*) FILTER (WHERE municipio IS NOT NULL)        AS municipio,
  count(*) FILTER (WHERE temperatura IS NOT NULL)      AS temperatura,
  count(*) FILTER (WHERE teor_da_conversa IS NOT NULL) AS teor,
  count(*) FILTER (WHERE responsavel IS NOT NULL)      AS responsavel,
  count(*) FILTER (WHERE observacao IS NOT NULL)       AS observacao,
  count(*) FILTER (WHERE status IS NOT NULL)           AS status,
  count(*) FILTER (WHERE encaminhamento IS NOT NULL)   AS encaminhamento,
  count(*) FILTER (WHERE sent_to_radar)                AS sent_to_radar
FROM radar_pe_contacts;
```

Esperado: `0` em tudo (ainda não há critério/humano na Etapa 2).

## 10. Edição manual não é sobrescrita (teste)

1. Editar nome/telefone de um contato pelo front/SQL:
   ```sql
   UPDATE radar_pe_contacts SET contact_name = 'Fulano (time)', phone = '5581900000000' WHERE id = '<id>';
   ```
2. Rodar o diário (ou `radar_pe_upsert_chat` de novo) pro mesmo chat.
3. Conferir que `contact_name`/`phone` continuam os valores do time (não voltam ao automático) e que `updated_at` mudou.

```sql
SELECT contact_name, phone, updated_at FROM radar_pe_contacts WHERE id = '<id>';
```

---

# Etapa 2b — mensagens estruturadas (`radar_pe_chats.messages`)

Rodar após aplicar o `schema.sql` e **re-rodar o backfill** (n8n 02) pra preencher `messages` dos chats existentes.

## 11. Messages preenchido

```sql
SELECT
  count(*) AS chats,
  count(*) FILTER (WHERE messages IS NOT NULL AND jsonb_array_length(messages) > 0) AS com_messages,
  count(*) FILTER (WHERE messages IS NULL OR jsonb_array_length(messages) = 0) AS sem_messages
FROM radar_pe_chats;
```

Esperado: `sem_messages` próximo de 0 após o re-backfill (só chats sem nenhuma mensagem ficam vazios).

## 12. Amostra das mensagens (shape + ordem por ts)

```sql
SELECT instance_name, remote_jid,
       jsonb_array_length(messages) AS qtd,
       messages->0 AS primeira,
       messages->-1 AS ultima
FROM radar_pe_chats
WHERE messages IS NOT NULL AND jsonb_array_length(messages) > 0
ORDER BY last_message_at DESC
LIMIT 10;
```

Esperado: elementos com `ts`, `from_me`, `body`, `msg_id`; `ultima` com `ts` = `last_message_at`.

## 13. Sem duplicatas por msg_id (após re-backfill)

```sql
SELECT count(*) AS chats_com_duplicata
FROM radar_pe_chats c
WHERE c.messages IS NOT NULL
  AND jsonb_array_length(c.messages) <>
     (SELECT count(DISTINCT m->>'msg_id')
      FROM jsonb_array_elements(c.messages) m);
```

Esperado: `0` (o append com dedup por `msg_id` não pode duplicar).

---

# Etapa 2b — sinais mecânicos (`last_message_from` + `temperatura_sugerida`)

Rodar após aplicar o `schema.sql` e **uma vez** o backfill dos sinais:

```sql
select radar_pe_backfill_signals();
```

(a partir daí o `radar_pe_upsert_chat` mantém os sinais frescos a cada captação.)

## 18. Distribuição da `temperatura_sugerida`

```sql
SELECT temperatura_sugerida, count(*) AS contatos
FROM radar_pe_contacts
GROUP BY temperatura_sugerida
ORDER BY contatos DESC;
```

Esperado: valores `frio`/`morno`/`quente` (e alguns `null` p/ chats sem `messages`). A proporção é referência pra calibrar com a Maíra.

## 19. `last_message_from` bate com a última mensagem do chat

```sql
SELECT count(*) AS inconsistentes
FROM radar_pe_contacts k
JOIN radar_pe_chats c ON c.id = k.chat_id
WHERE c.messages IS NOT NULL
  AND jsonb_array_length(c.messages) > 0
  AND k.last_message_from IS DISTINCT FROM
      CASE WHEN (c.messages->-1->>'from_me')::boolean THEN 'me' ELSE 'contact' END;
```

Esperado: `0`.

## 20. Sinais por contato (base pra calibrar a regra)

```sql
SELECT k.contact_name,
       k.temperatura_sugerida,
       k.last_message_from,
       count(*) FILTER (WHERE (m->>'from_me')::boolean = false) AS n_contact,
       count(*) FILTER (
         WHERE (m->>'from_me')::boolean = false
           AND (m->>'body') ~ '^\[(audio|imagem|video|figurinha|documento|localizacao)\]$'
       ) AS n_contact_media
FROM radar_pe_contacts k
JOIN radar_pe_chats c ON c.id = k.chat_id
LEFT JOIN LATERAL jsonb_array_elements(c.messages) m ON true
GROUP BY k.id, k.contact_name, k.temperatura_sugerida, k.last_message_from
ORDER BY n_contact_media DESC, n_contact DESC
LIMIT 50;
```

Esperado: `quente` só onde `n_contact_media >= 1` **e** `n_contact >= 2`; `frio` onde `n_contact = 0`; `morno` nos demais.

## 21. Automação não bumpa `updated_at`

Comparar antes/depois de re-rodar `radar_pe_backfill_signals()` (ou o diário) num contato que o time já editou:

```sql
SELECT id, temperatura_sugerida, last_message_from, updated_at
FROM radar_pe_contacts
WHERE updated_at < now() - interval '1 day'
ORDER BY updated_at DESC
LIMIT 5;
```

Esperado: rodar o backfill/diário e conferir que o `updated_at` desses contatos **não** mudou (a escrita é sob `radar_pe.is_auto`).

---

# Dedup `@lid` vs `@s.whatsapp.net`

Rodar após aplicar o `schema.sql` (canonicalização na captação) e **uma vez** o merge:

```sql
select radar_pe_merge_lid_duplicates();
```

## 14. Chats `@lid` restantes (devem ser só privacidade pura, sem número)

```sql
SELECT instance_name, remote_jid, jsonb_array_length(messages) AS qtd
FROM radar_pe_chats
WHERE remote_jid LIKE '%@lid'
ORDER BY instance_name, remote_jid;
```

Esperado: só `@lid` que nunca tiveram `remoteJidAlt` (sem número). Se sobrar um par `@lid` + `@s.whatsapp.net` da mesma conversa, o merge não o pegou (revisar).

## 15. Chats que compartilham `msg_id` (duplicatas ainda não unidas)

```sql
SELECT l.instance_name, l.remote_jid AS lid, n.remote_jid AS numero
FROM radar_pe_chats l
JOIN radar_pe_chats n
  ON n.instance_name = l.instance_name AND n.remote_jid LIKE '%@s.whatsapp.net'
WHERE l.remote_jid LIKE '%@lid'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(l.messages) lm
    JOIN jsonb_array_elements(n.messages) nm ON lm->>'msg_id' = nm->>'msg_id'
  );
```

Esperado: `0` linhas após o merge.

## 16. Chats `@lid` órfãos (sem `messages`) — candidatos à limpeza

```sql
SELECT instance_name, remote_jid
FROM radar_pe_chats
WHERE remote_jid LIKE '%@lid'
  AND (messages IS NULL OR jsonb_array_length(messages) = 0)
ORDER BY instance_name, remote_jid;
```

São chats da captação **pré-canonicalização** cuja conversa migrou pro chat do número (o dado real está lá). Rodar:

```sql
select radar_pe_cleanup_orphan_lids();
```

A função pula os órfãos cujo contato tem edição manual (status/encaminhamento/etc. preenchidos) e avisa num `NOTICE`.

## 17. Órfãos que seriam pulados (têm edição manual no contato)

```sql
SELECT c.instance_name, c.remote_jid, c.contact_name
FROM radar_pe_chats k
JOIN radar_pe_contacts c ON c.chat_id = k.id
WHERE k.remote_jid LIKE '%@lid'
  AND (k.messages IS NULL OR jsonb_array_length(k.messages) = 0)
  AND (c.origem IS NOT NULL OR c.comunidade IS NOT NULL OR c.municipio IS NOT NULL
    OR c.temperatura IS NOT NULL OR c.teor_da_conversa IS NOT NULL OR c.responsavel IS NOT NULL
    OR c.status IS NOT NULL OR c.encaminhamento IS NOT NULL OR c.observacao IS NOT NULL);
```

Esperado: `0` por enquanto (não houve edição manual). Se aparecer algo, revisar antes de apagar.

---

# Etapa 2b — casos de Radar (`radar_pe_cases`)

Rodar após aplicar o `schema.sql` e **uma vez** a detecção do histórico:

```sql
select radar_pe_detect_cases();
```

(a partir daí o `radar_pe_upsert_chat` detecta casos novos a cada captação.)

## 22. Total e distribuição por status

```sql
SELECT status, count(*) AS casos
FROM radar_pe_cases
GROUP BY status
ORDER BY casos DESC;
```

Esperado: casos `pendente` recém-detectados; `aprovado`/`descartado` conforme o time foi revisando.

## 23. Distribuição por frase-gatilho

```sql
SELECT matched_phrase, count(*) AS casos
FROM radar_pe_cases
GROUP BY matched_phrase
ORDER BY casos DESC;
```

Esperado: distribuição coerente com as frases do seed — base pra calibrar/ajustar a lista em `radar_pe_case_phrases`.

## 24. Idempotência: sem duplicata por (chat_id, trigger_msg_id)

```sql
SELECT count(*) AS duplicatas
FROM radar_pe_cases
WHERE trigger_msg_id IS NOT NULL
GROUP BY chat_id, trigger_msg_id
HAVING count(*) > 1;
```

Esperado: `0` (a constraint `unique(chat_id, trigger_msg_id)` impede).

## 25. Amostra de casos (frase + trecho congelado)

```sql
SELECT contact_name, phone, instance_name, matched_phrase,
       status, fragment_start_at, fragment_end_at,
       left(transcript_snapshot, 200) AS trecho
FROM radar_pe_cases
ORDER BY created_at DESC
LIMIT 20;
```

Esperado: `trecho` com "Eu:"/"Contato:" limitado às últimas ~10 mensagens + o gatilho (termina na mensagem que disparou).

## 26. Quantos contatos geraram casos (1 contato → N casos)

```sql
SELECT
  count(DISTINCT chat_id) AS chats_com_caso,
  count(*) AS casos,
  round(count(*)::numeric / nullif(count(DISTINCT chat_id), 0), 2) AS casos_por_chat
FROM radar_pe_cases;
```

Esperado: proporção baixa (poucos chats viram caso) e `casos_por_chat` ~1 na 1ª passagem.

## 27. Casos de uma conversa inteira viraram caso (checagem de recall)

```sql
SELECT instance_name, remote_jid, count(*) AS casos
FROM radar_pe_cases
GROUP BY instance_name, remote_jid
HAVING count(*) > 1
ORDER BY casos DESC
LIMIT 20;
```

Esperado: lista das conversas com mais de um caso — revisar manualmente se faz sentido (ou se são o mesmo caso repetido por frases diferentes).

---

# Etapa 2b — tempo real (webhook + `radar_pe_append_message`)

Rodar após aplicar o `schema.sql` e ligar o webhook (fluxo global → `06` → RPC).

## 28. Sessões de PE com caso detectado "ao vivo" (webhook)

Conferir que o append só grava sessões de `radar_pe_instances` (gatekeeper):

```sql
SELECT c.instance_name, count(*) AS casos
FROM radar_pe_cases c
LEFT JOIN radar_pe_instances i ON i.name = c.instance_name
WHERE i.name IS NULL
GROUP BY c.instance_name;
```

Esperado: `0` linhas (nenhum caso de sessão fora de PE).

## 29. Idempotência do append (sem duplicar `msg_id`)

```sql
SELECT count(*) AS chats_com_duplicata
FROM radar_pe_chats c
WHERE c.messages IS NOT NULL
  AND jsonb_array_length(c.messages) <>
     (SELECT count(DISTINCT m->>'msg_id') FROM jsonb_array_elements(c.messages) m);
```

Esperado: `0` (o append dedup por `msg_id`, mesmo com webhook + diário rodando juntos).

## 30. Consistência transcript × messages (append não "pula" linha)

```sql
SELECT count(*) AS inconsistentes
FROM radar_pe_chats c
WHERE c.transcript IS NOT NULL
  AND (
    (c.transcript LIKE 'Eu:%' OR c.transcript LIKE 'Contato:%') = false
  );
```

Esperado: `0` (toda linha do transcript começa com "Eu:"/"Contato:").

## 31. Latência de ponta a ponta (sanity)

Depois de mandar uma mensagem teste numa sessão PE, conferir que o caso/contato aparece em segundos:

```sql
SELECT contact_name, phone, last_message_at, last_message_from, temperatura_sugerida
FROM radar_pe_contacts
ORDER BY last_message_at DESC
LIMIT 5;
```

Esperado: a conversa de teste no topo, com `last_message_at` ~ agora (segundos), sem depender do diário das 8h.
