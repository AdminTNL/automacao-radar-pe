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
-- 1.1 Responsáveis (lista predefinida p/ atribuir nas sessões) — gerenciável pelo front
-- ---------------------------------------------------------------------------
create table if not exists radar_pe_responsaveis (
  name               text primary key        -- nome da pessoa responsável
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
  last_message_from   text check (last_message_from in ('me','contact')),  -- quem falou por último (automático)
  temperatura_sugerida text check (temperatura_sugerida in ('frio','morno','quente')),  -- sugestão automática (só leitura)
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

-- Sinais mecânicos (Etapa 2b): derivados de radar_pe_chats.messages.
-- (CHECKs só valem valores não-nulos; null = "sem messages p/ derivar".)
alter table radar_pe_contacts
  add column if not exists last_message_from text
    check (last_message_from in ('me','contact'));
alter table radar_pe_contacts
  add column if not exists temperatura_sugerida text
    check (temperatura_sugerida in ('frio','morno','quente'));

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
-- 3.2 Frases-gatilho (critério de caso) e Casos de Radar
-- ---------------------------------------------------------------------------

-- Critério fraseado (1ª passagem): uma mensagem NOSSA (from_me) que contenha uma
-- dessas frases vira um possível caso. Editável pela equipe via SQL sem redeploy.
create table if not exists radar_pe_case_phrases (
  id         uuid primary key default gen_random_uuid(),
  phrase     text not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

insert into radar_pe_case_phrases (phrase)
values
  ('Obrigado por compartilhar'),
  ('Obrigado pelo seu apoio'),
  ('Poder contar com seu apoio'),
  ('Vou compartilhar isso com'),
  ('Vou checar e'),
  ('Vou verificar'),
  ('Vou levar esse tema')
on conflict (phrase) do nothing;

-- 1 contato → N casos. Cada caso congela um trecho da conversa no momento da
-- identificação e nunca é sobrescrito pelo desenrolar da conversa.
create table if not exists radar_pe_cases (
  id                   uuid primary key default gen_random_uuid(),
  chat_id              uuid not null references radar_pe_chats(id) on delete cascade,
  contact_id           uuid references radar_pe_contacts(id) on delete set null,
  instance_name        text,
  remote_jid           text,
  contact_name         text,
  phone                text,
  trigger_msg_id       text,                    -- mensagem que disparou (idempotência)
  matched_phrase       text,                    -- frase que casou
  fragment_start_at    timestamptz,
  fragment_end_at      timestamptz,
  transcript_snapshot  text,                    -- trecho congelado (até N anteriores + gatilho)
  temperatura_snapshot text,                    -- temperatura_sugerida no momento
  status               text not null default 'pendente'
                       check (status in ('pendente','aprovado','descartado','enviado')),
  sent_to_radar        boolean not null default false,
  notion_page_id       text,
  sent_at              timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (chat_id, trigger_msg_id)
);

create index if not exists radar_pe_cases_status_idx on radar_pe_cases (status);
create index if not exists radar_pe_cases_chat_idx on radar_pe_cases (chat_id);
create index if not exists radar_pe_cases_created_idx on radar_pe_cases (created_at);

-- Toque humano em updated_at: só quando o time aprova/descarta/envia (não a detecção).
create or replace function radar_pe_cases_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('radar_pe.is_auto', true), '') <> 'on'
     and (
       new.status         is distinct from old.status
    or new.sent_to_radar  is distinct from old.sent_to_radar
    or new.notion_page_id is distinct from old.notion_page_id
     )
  then
    new.updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists radar_pe_cases_touch_trigger on radar_pe_cases;
create trigger radar_pe_cases_touch_trigger
  before update on radar_pe_cases
  for each row execute function radar_pe_cases_touch();

-- ---------------------------------------------------------------------------
-- 4. Funções RPC (chamadas via Supabase REST /rest/v1/rpc/*)
-- ---------------------------------------------------------------------------

-- Calcula e grava os sinais mecânicos de UM contato a partir do messages do chat.
-- Regra (1ª passagem, calibrável com a Maíra):
--   last_message_from   = from_me da última mensagem ('me' | 'contact' | null)
--   temperatura_sugerida: frio (contato nunca respondeu) / quente (respondeu com
--     mídia E não foi resposta única) / morno (demais). null quando não há messages.
-- A mídia é inferida pelo token [audio]/[imagem]/... no body (a captação não guarda o type).
create or replace function radar_pe_set_contact_signals(p_chat_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_msg_count       integer;
  v_n_contact       integer;
  v_n_contact_media integer;
  v_last_from       text;
  v_temp            text;
begin
  perform set_config('radar_pe.is_auto', 'on', true);

  -- 1. total de mensagens + último remetente (sem agregar)
  select
    coalesce(jsonb_array_length(c.messages), 0),
    case
      when (c.messages->-1->>'from_me')::boolean is null then null
      when (c.messages->-1->>'from_me')::boolean then 'me'
      else 'contact'
    end
  into v_msg_count, v_last_from
  from radar_pe_chats c
  where c.id = p_chat_id;

  if coalesce(v_msg_count, 0) = 0 then
    update radar_pe_contacts
       set last_message_from = null, temperatura_sugerida = null
     where chat_id = p_chat_id;
    return;
  end if;

  -- 2. sinais do contato (agregados sobre as mensagens)
  select
    count(*) filter (where (m->>'from_me')::boolean = false),
    count(*) filter (
      where (m->>'from_me')::boolean = false
        and (m->>'body') ~ '^\[(audio|imagem|video|figurinha|documento|localizacao)\]$'
    )
  into v_n_contact, v_n_contact_media
  from radar_pe_chats c
  left join lateral jsonb_array_elements(c.messages) m on true
  where c.id = p_chat_id;

  v_temp := case
    when v_n_contact = 0 then 'frio'
    when v_n_contact_media >= 1 and v_n_contact >= 2 then 'quente'
    else 'morno'
  end;

  update radar_pe_contacts
     set last_message_from = v_last_from, temperatura_sugerida = v_temp
   where chat_id = p_chat_id;
end;
$$;

-- Detecta possíveis casos de Radar num chat a partir das frases ativas de
-- radar_pe_case_phrases. Regra (1ª passagem): mensagem nossa (from_me) cujo body
-- contém uma frase (ILIKE, substring). Congela as últimas v_context_size mensagens
-- + o gatilho. Idempotente via unique(chat_id, trigger_msg_id).
create or replace function radar_pe_detect_cases_for_chat(p_chat_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_context_size integer := 10;  -- nº de mensagens anteriores ao gatilho congeladas
  v_chat    radar_pe_chats%rowtype;
  v_contact radar_pe_contacts%rowtype;
  v_msgs    jsonb;
  v_total   integer;
  v_idx     integer;
  v_trigger jsonb;
  v_phrase  text;
  v_from_idx integer;
  v_ts_start timestamptz;
  v_ts_end   timestamptz;
  v_snapshot text;
begin
  perform set_config('radar_pe.is_auto', 'on', true);

  select * into v_chat from radar_pe_chats where id = p_chat_id;
  if not found or v_chat.messages is null or jsonb_array_length(v_chat.messages) = 0 then
    return;
  end if;

  select * into v_contact from radar_pe_contacts where chat_id = p_chat_id;

  v_msgs  := v_chat.messages;
  v_total := jsonb_array_length(v_msgs);

  for v_idx in 0 .. v_total - 1 loop
    v_trigger := v_msgs->v_idx;

    -- só mensagens nossas, com msg_id (senão a dedup por (chat_id, msg_id) não vale)
    if (v_trigger->>'from_me')::boolean is not true
       or (v_trigger->>'msg_id') is null then
      continue;
    end if;

    select p.phrase into v_phrase
    from radar_pe_case_phrases p
    where p.active
      and coalesce(v_trigger->>'body', '') ilike '%' || p.phrase || '%'
    order by length(p.phrase) desc
    limit 1;

    if v_phrase is null then
      continue;
    end if;

    v_from_idx := greatest(0, v_idx - v_context_size);
    v_ts_start := (v_msgs->v_from_idx->>'ts')::timestamptz;
    v_ts_end   := (v_trigger->>'ts')::timestamptz;

    select string_agg(
      case when (m->>'from_me')::boolean then 'Eu' else 'Contato' end || ': ' || (m->>'body'),
      E'\n' order by ord
    )
      into v_snapshot
    from jsonb_array_elements(v_msgs) with ordinality as t(m, ord)
    where ord >= v_from_idx + 1 and ord <= v_idx + 1
      and (m->>'body') is not null and (m->>'body') <> '';

    insert into radar_pe_cases
      (chat_id, contact_id, instance_name, remote_jid, contact_name, phone,
       trigger_msg_id, matched_phrase, fragment_start_at, fragment_end_at,
       transcript_snapshot, temperatura_snapshot)
    values
      (v_chat.id, v_contact.id, v_chat.instance_name, v_chat.remote_jid,
       coalesce(v_contact.contact_name, v_chat.contact_name),
       coalesce(v_contact.phone, v_chat.phone),
       v_trigger->>'msg_id', v_phrase, v_ts_start, v_ts_end,
       v_snapshot, v_contact.temperatura_sugerida)
    on conflict (chat_id, trigger_msg_id) do nothing;
  end loop;
end;
$$;

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
        first_message_at = least(coalesce(excluded.first_message_at, radar_pe_chats.first_message_at),
                                 coalesce(radar_pe_chats.first_message_at, excluded.first_message_at)),
        last_message_at  = greatest(coalesce(excluded.last_message_at, radar_pe_chats.last_message_at),
                                    coalesce(radar_pe_chats.last_message_at, excluded.last_message_at)),
        checkpoint       = greatest(coalesce(excluded.checkpoint, radar_pe_chats.checkpoint),
                                    coalesce(radar_pe_chats.checkpoint, excluded.checkpoint)),
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
        first_message_at = least(coalesce(excluded.first_message_at, radar_pe_contacts.first_message_at),
                                 coalesce(radar_pe_contacts.first_message_at, excluded.first_message_at)),
        last_message_at  = greatest(coalesce(excluded.last_message_at, radar_pe_contacts.last_message_at),
                                    coalesce(radar_pe_contacts.last_message_at, excluded.last_message_at));

  -- Sinais mecânicos sempre frescos após cada escrita (backfill e diário).
  perform radar_pe_set_contact_signals(v_id);
  -- Detecção de casos também roda aqui (idempotente), mantendo a lista sempre em dia.
  perform radar_pe_detect_cases_for_chat(v_id);

  return v_id;
end;
$$;

-- Append incremental de UMA mensagem (caminho do webhook "ao vivo"). Cria o chat/contato
-- se for conversa nova, faz append da mensagem (dedup por msg_id, sort por ts) e da linha
-- no transcript, atualiza first/last/checkpoint monotônicos e roda sinais + detecção.
-- Gatekeeper: ignora sessões fora de radar_pe_instances (o webhook global recebe evento
-- de todas as sessões; só PE interessa). Idempotente (msg_id duplicada não re-apenda).
create or replace function radar_pe_append_message(
  p_instance_name text,
  p_remote_jid    text,
  p_contact_name  text,
  p_phone         text,
  p_ts            timestamptz,
  p_from_me       boolean,
  p_body          text,
  p_msg_id        text
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id     uuid;
  v_is_dup boolean;
  v_line   text;
begin
  -- só sessões de PE (fonte de verdade = radar_pe_instances, a mesma do diário)
  if not exists (select 1 from radar_pe_instances where name = p_instance_name) then
    return;
  end if;

  -- ignora sem conteúdo real (status/ack chegam como "." ou vazio)
  if p_body is null or btrim(p_body) in ('', '.') then
    return;
  end if;

  perform set_config('radar_pe.is_auto', 'on', true);

  -- cria o chat se ainda não existir (conversa nova).
  -- nome só vem de mensagem RECEBIDA (mensagem nossa traz o nome da própria sessão)
  insert into radar_pe_chats (instance_name, remote_jid, contact_name, phone)
  values (p_instance_name, p_remote_jid,
          case when p_from_me then null else p_contact_name end,
          p_phone)
  on conflict (instance_name, remote_jid) do nothing;

  select id into v_id
  from radar_pe_chats
  where instance_name = p_instance_name and remote_jid = p_remote_jid;

  -- já temos essa mensagem? (dedup por msg_id)
  select exists (
    select 1
    from jsonb_array_elements(coalesce((select messages from radar_pe_chats where id = v_id), '[]'::jsonb)) m
    where m->>'msg_id' = p_msg_id
  ) into v_is_dup;

  -- append da mensagem + da linha do transcript (só se for nova)
  if not v_is_dup then
    v_line := case when p_from_me then 'Eu' else 'Contato' end || ': ' || p_body;

    update radar_pe_chats
       set messages   = coalesce((
             select jsonb_agg(m order by (m->>'ts')::timestamptz)
             from (
               select distinct on (m->>'msg_id') m
               from jsonb_array_elements(coalesce(radar_pe_chats.messages, '[]'::jsonb)
                     || jsonb_build_array(jsonb_build_object(
                          'ts', p_ts, 'from_me', p_from_me, 'body', p_body, 'msg_id', p_msg_id))) as e(m)
             ) d
           ), '[]'::jsonb),
           transcript = case
             when radar_pe_chats.transcript is null or radar_pe_chats.transcript = '' then v_line
             else radar_pe_chats.transcript || E'\n' || v_line
           end
     where id = v_id;
  end if;

  -- nome/telefone (system wins quando não vazio) + first/last/checkpoint monotônicos.
  -- nome não é atualizado por mensagem nossa (só mensagem recebida carrega nome do contato)
  update radar_pe_chats
     set contact_name     = case
           when p_from_me then contact_name
           else coalesce(nullif(p_contact_name, ''), contact_name)
         end,
         phone            = coalesce(nullif(p_phone, ''), phone),
         first_message_at = least(coalesce(p_ts, first_message_at), coalesce(first_message_at, p_ts)),
         last_message_at  = greatest(coalesce(p_ts, last_message_at), coalesce(last_message_at, p_ts)),
         checkpoint       = greatest(coalesce(p_ts, checkpoint), coalesce(checkpoint, p_ts))
   where id = v_id;

  -- upsert do contato (registro de negócio)
  insert into radar_pe_contacts
    (chat_id, instance_name, remote_jid, contact_name, phone, first_message_at, last_message_at)
  values
    (v_id, p_instance_name, p_remote_jid,
     case when p_from_me then null else p_contact_name end,
     p_phone, p_ts, p_ts)
  on conflict (chat_id) do update
    set instance_name    = excluded.instance_name,
        remote_jid       = excluded.remote_jid,
        contact_name     = case
          when p_from_me then radar_pe_contacts.contact_name
          else coalesce(excluded.contact_name, radar_pe_contacts.contact_name)
        end,
        phone            = coalesce(excluded.phone, radar_pe_contacts.phone),
        first_message_at = least(coalesce(excluded.first_message_at, radar_pe_contacts.first_message_at),
                                 coalesce(radar_pe_contacts.first_message_at, excluded.first_message_at)),
        last_message_at  = greatest(coalesce(excluded.last_message_at, radar_pe_contacts.last_message_at),
                                    coalesce(radar_pe_contacts.last_message_at, excluded.last_message_at));

  -- sinais sempre frescos; detecção só faz sentido em mensagem nossa (frases-gatilho)
  perform radar_pe_set_contact_signals(v_id);
  if p_from_me then
    perform radar_pe_detect_cases_for_chat(v_id);
  end if;
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

-- Recalcula os sinais mecânicos (last_message_from + temperatura_sugerida) de todos
-- os contatos a partir do messages do chat. Idempotente. Rode uma vez após aplicar o
-- schema da Etapa 2b, e depois de qualquer merge que mexa em messages. Retorna quantos chats processou.
create or replace function radar_pe_backfill_signals()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in select id from radar_pe_chats loop
    perform radar_pe_set_contact_signals(r.id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Detecta casos de Radar em todos os chats (histórico). Idempotente. Rode uma vez
-- após aplicar o schema da Etapa 2b, e depois de ajustar as frases. Retorna quantos chats processou.
create or replace function radar_pe_detect_cases()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in select id from radar_pe_chats loop
    perform radar_pe_detect_cases_for_chat(r.id);
    v_count := v_count + 1;
  end loop;

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

    -- 6. mensagens mudaram → recalcula sinais mecânicos e casos do chat canônico
    perform radar_pe_set_contact_signals(r.num_id);
    perform radar_pe_detect_cases_for_chat(r.num_id);

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
