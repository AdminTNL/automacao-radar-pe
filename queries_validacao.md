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
