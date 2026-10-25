-- =====================================================================
--  Clínica Aurora Estética — Atendente IA
--  FICHEIRO 1 de 2: ESTRUTURA DA BASE DE DADOS
--  Cola tudo no SQL Editor do Supabase e carrega em "Run". Corre só 1 vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CONFIGURAÇÃO DA CLÍNICA (uma única linha)
--    O campo "info_ia" é o texto que a IA vai usar para responder.
-- ---------------------------------------------------------------------
create table if not exists public.clinic_settings (
  id                 int primary key default 1 check (id = 1),
  name               text not null,
  phone              text,
  address            text,
  timezone           text not null default 'America/Sao_Paulo',
  slot_interval_min  int  not null default 30 check (slot_interval_min between 5 and 120),
  welcome_message    text,
  info_ia            text,
  bot_enabled        boolean not null default true,
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. SERVIÇOS
-- ---------------------------------------------------------------------
create table if not exists public.services (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  duration_min  int not null check (duration_min between 5 and 480),
  price         numeric(10,2) not null default 0 check (price >= 0),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. HORÁRIO DE FUNCIONAMENTO (0 = domingo ... 6 = sábado)
-- ---------------------------------------------------------------------
create table if not exists public.business_hours (
  weekday      int primary key check (weekday between 0 and 6),
  is_open      boolean not null default true,
  open_time    time not null default '09:00',
  close_time   time not null default '18:00',
  break_start  time,
  break_end    time,
  check (close_time > open_time),
  check ((break_start is null and break_end is null) or (break_end > break_start))
);

-- ---------------------------------------------------------------------
-- 4. DIAS BLOQUEADOS (feriados, folgas)
-- ---------------------------------------------------------------------
create table if not exists public.blocked_dates (
  id      uuid primary key default gen_random_uuid(),
  day     date not null unique,
  reason  text
);

-- ---------------------------------------------------------------------
-- 5. CLIENTES / CONTACTOS
--    bot_paused = true -> a IA deixa de responder a este contacto
--    stage      -> etapas do mini-CRM (extra)
-- ---------------------------------------------------------------------
create table if not exists public.customers (
  id               uuid primary key default gen_random_uuid(),
  name             text,
  phone            text not null unique,
  notes            text,
  stage            text not null default 'novo' check (stage in ('novo','orcamento','fechado','perdido')),
  bot_paused       boolean not null default false,
  needs_human      boolean not null default false,
  last_message_at  timestamptz,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 6. MARCAÇÕES
--    A regra "exclude" impede DUAS marcações no mesmo horário,
--    mesmo que a IA tente. A base de dados recusa.
-- ---------------------------------------------------------------------
create table if not exists public.appointments (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references public.customers(id) on delete cascade,
  service_id        uuid not null references public.services(id) on delete restrict,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  status            text not null default 'marcado'
                    check (status in ('marcado','confirmado','concluido','cancelado','faltou')),
  source            text not null default 'painel' check (source in ('painel','whatsapp','simulador')),
  notes             text,
  reminder_sent_at  timestamptz,
  confirmed_at      timestamptz,
  created_at        timestamptz not null default now(),
  check (ends_at > starts_at),
  constraint appointments_sem_sobreposicao
    exclude using gist (tstzrange(starts_at, ends_at, '[)') with &&)
    where (status in ('marcado','confirmado'))
);

create index if not exists appointments_starts_at_idx on public.appointments (starts_at);
create index if not exists appointments_customer_idx  on public.appointments (customer_id);

-- ---------------------------------------------------------------------
-- 7. MENSAGENS (conversas do WhatsApp e do simulador)
--    sender: cliente | bot | humano
-- ---------------------------------------------------------------------
create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers(id) on delete cascade,
  sender       text not null check (sender in ('cliente','bot','humano')),
  body         text not null,
  channel      text not null default 'whatsapp' check (channel in ('whatsapp','simulador')),
  created_at   timestamptz not null default now()
);

create index if not exists messages_customer_idx on public.messages (customer_id, created_at);

-- Atualiza "last_message_at" do cliente sempre que entra uma mensagem
create or replace function public.touch_customer_last_message()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.customers
     set last_message_at = new.created_at
   where id = new.customer_id
     and (last_message_at is null or last_message_at < new.created_at);
  return new;
end;
$$;

drop trigger if exists messages_touch_customer on public.messages;
create trigger messages_touch_customer
after insert on public.messages
for each row execute function public.touch_customer_last_message();

-- ---------------------------------------------------------------------
-- 8. HORÁRIOS DISPONÍVEIS
--    Devolve os horários livres de um serviço num dia.
--    O painel usa-a agora; a IA vai usar exatamente a mesma na fase B.
-- ---------------------------------------------------------------------
create or replace function public.available_slots(p_service_id uuid, p_day date)
returns table (slot_start timestamptz, slot_end timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as (
    select timezone as tz, slot_interval_min as step
      from clinic_settings where id = 1
  ),
  svc as (
    select duration_min from services where id = p_service_id and active
  ),
  hrs as (
    select h.* from business_hours h
     where h.weekday = extract(dow from p_day)::int
       and h.is_open
       and not exists (select 1 from blocked_dates b where b.day = p_day)
  ),
  candidates as (
    -- "lt" = hora local (sem fuso), "s"/"e" = início e fim com fuso
    select (lt at time zone cfg.tz)                                           as s,
           (lt at time zone cfg.tz) + make_interval(mins => svc.duration_min) as e,
           lt                                                                 as local_start,
           lt + make_interval(mins => svc.duration_min)                       as local_end,
           hrs.break_start, hrs.break_end
      from cfg, svc, hrs,
           generate_series(p_day + hrs.open_time,
                           p_day + hrs.close_time - make_interval(mins => svc.duration_min),
                           make_interval(mins => cfg.step)) as lt
  )
  select c.s, c.e
    from candidates c
   where c.s > now()
     and not (c.break_start is not null
              and c.local_start < p_day + c.break_end
              and c.local_end   > p_day + c.break_start)
     and not exists (
       select 1 from appointments a
        where a.status in ('marcado','confirmado')
          and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(c.s, c.e, '[)')
     )
   order by c.s;
$$;

-- ---------------------------------------------------------------------
-- 9. SEGURANÇA (RLS)
--    Ninguém sem login vê ou altera nada.
--    Só utilizadores com login (a equipa da clínica) têm acesso.
-- ---------------------------------------------------------------------
alter table public.clinic_settings enable row level security;
alter table public.services        enable row level security;
alter table public.business_hours  enable row level security;
alter table public.blocked_dates   enable row level security;
alter table public.customers       enable row level security;
alter table public.appointments    enable row level security;
alter table public.messages        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['clinic_settings','services','business_hours','blocked_dates',
                           'customers','appointments','messages']
  loop
    execute format('drop policy if exists "equipa_acesso_total" on public.%I', t);
    execute format(
      'create policy "equipa_acesso_total" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Quem não tem login não pode usar as funções
revoke execute on function public.available_slots(uuid, date) from public, anon;
grant  execute on function public.available_slots(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- 10. TEMPO REAL (as conversas atualizam sozinhas no painel)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.messages;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.customers;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.appointments;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- Fim do ficheiro 1. Agora corre o ficheiro 2 (dados de exemplo).
