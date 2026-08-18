-- ============================================================================
-- Radar Mobiliza PE — schema (Supabase / Postgres)
-- Rode este arquivo inteiro no SQL Editor do Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Instâncias (sessões da Evolution) — seed manual com nome + categoria
-- ---------------------------------------------------------------------------
create table if not exists radar_pe_instances (
  name               text primary key,        -- nome exato da instância na Evolution
  category           text,                    -- TÔ COM JOÃO / MOBILIZA / CHEGA JUNTO PE / IR
  responsavel        text,                    -- pessoa responsável pela sessão
  connection_state   text,
  last_activity_at   timestamptz,
  last_sync_at       timestamptz,
  offline            boolean not null default false
);

-- Migração p/ bancos onde a tabela já existia antes.
alter table radar_pe_instances add column if not exists responsavel text;

-- ---------------------------------------------------------------------------
-- 2. Chats (um por contato/conversa) — camada de captação (Etapa 1)
-- ---------------------------------------------------------------------------
create table if not exists radar_pe_chats (
  id                 uuid primary key default gen_random_uuid(),
  instance_name      text not null references radar_pe_instances(name),
  remote_jid         text not null,           -- ex.: 5581999999999@s.whatsapp.net
  contact_name       text,
  phone              text,
  first_message_at   timestamptz,
  last_message_at    timestamptz,
  checkpoint         timestamptz,             -- timestamp da última mensagem já lida
  transcript         text,                    -- transcrição completa renderizada
  messages           jsonb,                   -- [{ts, from_me, body, msg_id}] — base p/ "por dia" e fragmento
  unique (instance_name, remote_jid)
);

create index if not exists radar_pe_chats_instance_idx on radar_pe_chats (instance_name);
create index if not exists radar_pe_chats_last_message_idx on radar_pe_chats (last_message_at);

-- Migração p/ bancos onde a tabela já existia antes da Etapa 2b.
alter table radar_pe_chats add column if not exists messages jsonb;

-- ---------------------------------------------------------------------------
-- 3. Contatos ("todos os contatos") — registro de negócio (Etapa 2)
-- ---------------------------------------------------------------------------
create table if not exists radar_pe_contacts (
  id                 uuid primary key default gen_random_uuid(),
  chat_id            uuid not null references radar_pe_chats(id),
  instance_name      text,
  remote_jid         text,
  contact_name       text,
  phone              text,
  origem             text,
  first_message_at   timestamptz,
  last_message_at    timestamptz,             -- última atividade (pro front ordenar por quentura)
  comunidade         text,                    -- cruzamento (depois)
  municipio          text,                    -- cruzamento (depois)
  temperatura        text,                    -- humano
  teor_da_conversa   text,                    -- humano → IA depois
  responsavel        text,                    -- humano
  status             text,                    -- Não iniciado / Para iniciar / Respondido / Concluído
  encaminhamento     text,                    -- Relatório / Formulário / Sem encaminhamento
  observacao         text,                    -- humano → IA resumo
  sent_to_radar      boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists radar_pe_contacts_instance_idx on radar_pe_contacts (instance_name);
create index if not exists radar_pe_contacts_remote_jid_idx on radar_pe_contacts (remote_jid);

-- Migração p/ bancos onde a tabela já existia antes da Etapa 2.
-- (precisa rodar ANTES dos índices novos, que dependem da coluna/constraint.)
-- (set not null falha se houver contato com chat_id null — Etapa 2 começa vazia.)
alter table radar_pe_contacts add column if not exists last_message_at timestamptz;
alter table radar_pe_contacts alter column chat_id set not null;

-- 1 contato por conversa (chave mestre = chat_id, 1:1 com radar_pe_chats).
create unique index if not exists radar_pe_contacts_chat_id_key on radar_pe_contacts (chat_id);
create index if not exists radar_pe_contacts_last_message_idx on radar_pe_contacts (last_message_at);

-- ---------------------------------------------------------------------------
-- 3.1 Trigger de "toque humano" em updated_at
-- updated_at só avança quando o time edita um campo de negócio (não a automação).
-- A automação sinaliza via set_config('radar_pe.is_auto', 'on', true).
-- ---------------------------------------------------------------------------
create or replace function radar_pe_contacts_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('radar_pe.is_auto', true), '') <> 'on'
     and (
       new.contact_name     is distinct from old.contact_name
    or new.phone            is distinct from old.phone
    or new.origem           is distinct from old.origem
    or new.comunidade       is distinct from old.comunidade
    or new.municipio        is distinct from old.municipio
    or new.temperatura      is distinct from old.temperatura
    or new.teor_da_conversa is distinct from old.teor_da_conversa
    or new.responsavel      is distinct from old.responsavel
    or new.observacao       is distinct from old.observacao
    or new.status           is distinct from old.status
    or new.encaminhamento   is distinct from old.encaminhamento
    or new.sent_to_radar    is distinct from old.sent_to_radar
     )
  then
    new.updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists radar_pe_contacts_touch_trigger on radar_pe_contacts;
create trigger radar_pe_contacts_touch_trigger
  before update on radar_pe_contacts
  for each row execute function radar_pe_contacts_touch();

-- ---------------------------------------------------------------------------
-- 4. Funções RPC (chamadas via Supabase REST /rest/v1/rpc/*)
-- ---------------------------------------------------------------------------

-- Upsert de um chat (INSERT ... ON CONFLICT DO UPDATE). Retorna o id do chat.
create or replace function radar_pe_upsert_chat(
  p_instance_name   text,
  p_remote_jid      text,
  p_contact_name    text,
  p_phone           text,
  p_first_message_at timestamptz,
  p_last_message_at timestamptz,
  p_checkpoint      timestamptz,
  p_transcript      text,
  p_messages        jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Sinaliza pro trigger de updated_at que esta escrita é da automação,
  -- não do time — assim o auto-preenchimento não "suja" o toque humano.
  perform set_config('radar_pe.is_auto', 'on', true);

  insert into radar_pe_chats
    (instance_name, remote_jid, contact_name, phone, first_message_at, last_message_at, checkpoint, transcript)
  values
    (p_instance_name, p_remote_jid, p_contact_name, p_phone,
     p_first_message_at, p_last_message_at, p_checkpoint, p_transcript)
  on conflict (instance_name, remote_jid) do update
    set contact_name     = coalesce(excluded.contact_name, radar_pe_chats.contact_name),
        phone            = coalesce(excluded.phone, radar_pe_chats.phone),
        first_message_at = coalesce(excluded.first_message_at, radar_pe_chats.first_message_at),
        last_message_at  = coalesce(excluded.last_message_at, radar_pe_chats.last_message_at),
        checkpoint       = coalesce(excluded.checkpoint, radar_pe_chats.checkpoint),
        transcript       = coalesce(excluded.transcript, radar_pe_chats.transcript)
  returning id into v_id;

  -- Append de mensagens com dedup por msg_id (backfill manda histórico completo,
  -- re-backfill não duplica; diário manda só as novas). Ordena por ts.
  if p_messages is not null and jsonb_array_length(p_messages) > 0 then
    update radar_pe_chats
       set messages = coalesce((
         select jsonb_agg(m order by (m->>'ts')::timestamptz)
         from (
           select distinct on (m->>'msg_id') m
           from jsonb_array_elements(coalesce(radar_pe_chats.messages, '[]'::jsonb) || p_messages) as e(m)
         ) d
       ), '[]'::jsonb)
     where id = v_id;
  end if;

  -- Upsert do contato (registro de negócio). Só campos automáticos;
  -- nome/telefone são do sistema ("system wins"): o WhatsApp sobrescreve;
  -- só preserva valor manual quando a Evolution não traz nada (vazio/@lid).
  insert into radar_pe_contacts
    (chat_id, instance_name, remote_jid, contact_name, phone, first_message_at, last_message_at)
  values
    (v_id, p_instance_name, p_remote_jid, p_contact_name, p_phone,
     p_first_message_at, p_last_message_at)
  on conflict (chat_id) do update
    set instance_name    = excluded.instance_name,
        remote_jid       = excluded.remote_jid,
        contact_name     = coalesce(excluded.contact_name, radar_pe_contacts.contact_name),
        phone            = coalesce(excluded.phone, radar_pe_contacts.phone),
        first_message_at = coalesce(radar_pe_contacts.first_message_at, excluded.first_message_at),
        last_message_at  = coalesce(excluded.last_message_at, radar_pe_contacts.last_message_at);

  return v_id;
end;
$$;

-- Backfill pontual: cria o contato p/ os chats já capturados antes da Etapa 2.
-- Idempotente (só insere onde ainda não há contato). Retorna quantos inseriu.
create or replace function radar_pe_backfill_contacts()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into radar_pe_contacts
    (chat_id, instance_name, remote_jid, contact_name, phone, first_message_at, last_message_at)
  select c.id, c.instance_name, c.remote_jid, c.contact_name, c.phone,
         c.first_message_at, c.last_message_at
  from radar_pe_chats c
  where not exists (select 1 from radar_pe_contacts k where k.chat_id = c.id);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Dedup de @lid vs @s.whatsapp.net: une chats/contatos que são a MESMA conversa
-- (detectada por msg_id compartilhado no messages). Mantém o @s.whatsapp.net como
-- canônico. Idempotente (só une pares que ainda existem). Retorna quantos pares uniu.
create or replace function radar_pe_merge_lid_duplicates()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  r record;
  v_merged jsonb;
  v_transcript text;
  v_first timestamptz;
  v_last timestamptz;
  v_count integer := 0;
begin
  perform set_config('radar_pe.is_auto', 'on', true);

  for r in
    select distinct on (l.id)
      l.id        as lid_id,
      l.messages  as lid_msgs,
      n.id        as num_id,
      n.messages  as num_msgs,
      n.checkpoint as num_checkpoint
    from radar_pe_chats l
    join radar_pe_chats n
      on n.instance_name = l.instance_name
     and n.remote_jid like '%@s.whatsapp.net'
    where l.remote_jid like '%@lid'
      and l.messages is not null and n.messages is not null
      and exists (
        select 1
        from jsonb_array_elements(l.messages) lm
        join jsonb_array_elements(n.messages) nm
          on lm->>'msg_id' = nm->>'msg_id'
      )
    order by l.id
  loop
    -- 1. une mensagens (dedup por msg_id, ordena por ts)
    select jsonb_agg(m order by (m->>'ts')::timestamptz)
      into v_merged
      from (
        select distinct on (m->>'msg_id') m
        from (
          select jsonb_array_elements(r.num_msgs) as m
          union all
          select jsonb_array_elements(r.lid_msgs) as m
        ) u
        order by m->>'msg_id'
      ) d;

    -- 2. limites de tempo
    select min((m->>'ts')::timestamptz), max((m->>'ts')::timestamptz)
      into v_first, v_last
    from jsonb_array_elements(v_merged) m;

    -- 3. regenera o transcript
    select string_agg(
      case when (m->>'from_me')::boolean then 'Eu' else 'Contato' end || ': ' || (m->>'body'),
      E'\n' order by (m->>'ts')::timestamptz
    )
      into v_transcript
    from jsonb_array_elements(v_merged) m
    where (m->>'body') is not null and (m->>'body') <> '';

    -- 4. atualiza o chat canônico (número)
    update radar_pe_chats
       set messages         = v_merged,
           transcript       = v_transcript,
           first_message_at = coalesce(v_first, first_message_at),
           last_message_at  = coalesce(v_last, last_message_at),
           checkpoint       = greatest(checkpoint, r.num_checkpoint,
                                 (select checkpoint from radar_pe_chats where id = r.lid_id)),
           contact_name     = coalesce(contact_name, (select contact_name from radar_pe_chats where id = r.lid_id)),
           phone            = coalesce(phone, (select phone from radar_pe_chats where id = r.lid_id))
     where id = r.num_id;

    -- 5. une contatos (o do número prevalece; preenche nome/telefone do lid se vazio)
    update radar_pe_contacts
       set contact_name = coalesce(contact_name, (select contact_name from radar_pe_contacts where chat_id = r.lid_id)),
           phone        = coalesce(phone, (select phone from radar_pe_contacts where chat_id = r.lid_id))
     where chat_id = r.num_id;

    delete from radar_pe_contacts where chat_id = r.lid_id;
    delete from radar_pe_chats where id = r.lid_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Limpa chats @lid "órfãos" (sem messages) deixados pela captação pré-canonicalização:
-- a conversa já migrou pro chat do número (o dado real vive lá). Pula contatos com edição
-- manual (campos de critério/humano) pra não perder trabalho futuro. Idempotente.
-- Retorna quantos chats apagou (os pulados aparecem num NOTICE).
create or replace function radar_pe_cleanup_orphan_lids()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  r record;
  v_deleted integer := 0;
  v_skipped integer := 0;
begin
  perform set_config('radar_pe.is_auto', 'on', true);

  for r in
    select id
    from radar_pe_chats
    where remote_jid like '%@lid'
      and (messages is null or jsonb_array_length(messages) = 0)
  loop
    -- não apaga contato que o time já editou (campo humano/critério preenchido)
    if exists (
      select 1 from radar_pe_contacts c
      where c.chat_id = r.id
        and (c.origem           is not null
          or c.comunidade       is not null
          or c.municipio        is not null
          or c.temperatura      is not null
          or c.teor_da_conversa is not null
          or c.responsavel      is not null
          or c.status           is not null
          or c.encaminhamento   is not null
          or c.observacao       is not null)
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    delete from radar_pe_contacts where chat_id = r.id;
    delete from radar_pe_chats where id = r.id;
    v_deleted := v_deleted + 1;
  end loop;

  raise notice 'orphan_lids: deleted=%, skipped (edicao manual)=%', v_deleted, v_skipped;
  return v_deleted;
end;
$$;

-- Busca o transcript/checkpoint de um chat. Sempre retorna 1 linha (nulos se não existir),
-- para o nó HTTP do n8n nunca ficar sem item e travar o fluxo.
create or replace function radar_pe_get_chat(
  p_instance_name text,
  p_remote_jid    text
) returns table (transcript text, checkpoint timestamptz, last_message_at timestamptz)
language sql
security invoker
set search_path = public
as $$
  select c.transcript, c.checkpoint, c.last_message_at
  from radar_pe_chats c
  where c.instance_name = p_instance_name and c.remote_jid = p_remote_jid
  union all
  select null::text, null::timestamptz, null::timestamptz
  where not exists (
    select 1 from radar_pe_chats c2
    where c2.instance_name = p_instance_name and c2.remote_jid = p_remote_jid
  );
$$;

-- Lista as instâncias (nome + categoria).
create or replace function radar_pe_list_instances()
returns table (name text, category text)
language sql
security invoker
set search_path = public
as $$
  select i.name, i.category from radar_pe_instances i order by i.name;
$$;

-- Atualiza o estado de saúde de uma instância.
create or replace function radar_pe_mark_instance_health(
  p_name             text,
  p_connection_state text
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  update radar_pe_instances
     set connection_state = p_connection_state,
         offline          = (coalesce(p_connection_state, 'close') = 'close'),
         last_sync_at     = now()
   where name = p_name;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Seed de exemplo (ajuste com as ~50 sessões reais; só name + category)
-- ---------------------------------------------------------------------------
-- insert into radar_pe_instances (name, category) values
--   ('mobiliza-01', 'MOBILIZA'),
--   ('ir-01', 'IR');
