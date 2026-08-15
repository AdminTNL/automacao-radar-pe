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
  connection_state   text,
  last_activity_at   timestamptz,
  last_sync_at       timestamptz,
  offline            boolean not null default false
);

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
  unique (instance_name, remote_jid)
);

create index if not exists radar_pe_chats_instance_idx on radar_pe_chats (instance_name);
create index if not exists radar_pe_chats_last_message_idx on radar_pe_chats (last_message_at);

-- ---------------------------------------------------------------------------
-- 3. Contatos ("todos os contatos") — registro de negócio (Etapa 2)
-- ---------------------------------------------------------------------------
create table if not exists radar_pe_contacts (
  id                 uuid primary key default gen_random_uuid(),
  chat_id            uuid references radar_pe_chats(id),
  instance_name      text,
  remote_jid         text,
  contact_name       text,
  phone              text,
  origem             text,
  first_message_at   timestamptz,
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
  p_transcript      text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
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

  return v_id;
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
