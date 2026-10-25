-- =====================================================================
--  Clínica Aurora Estética — Atendente IA
--  FICHEIRO 4: INTELIGÊNCIA ARTIFICIAL
--  Cola tudo no SQL Editor do Supabase e carrega em "Run".
--  Pode correr-se mais do que uma vez sem estragar nada.
--
--  O que faz:
--   • interruptor "IA ligada" e limite diário de respostas da IA
--   • contador de respostas da IA por dia (para não gastar o saldo)
--   • receive_message(): recebe a mensagem, trata as regras fixas
--     (lembrete 1/2, pedido de atendente) e diz se a IA deve responder.
--     Se a IA estiver desligada ou o limite acabar, usa as respostas
--     automáticas por palavras-chave.
-- =====================================================================

-- 1) Definições da IA ------------------------------------------------------
--    Tabela própria, para o botão "Repor dados de demonstração" não as apagar.
create table if not exists public.ai_settings (
  id           int primary key default 1 check (id = 1),
  enabled      boolean not null default false,
  daily_limit  int not null default 200 check (daily_limit between 0 and 5000)
);
insert into public.ai_settings (id) values (1) on conflict (id) do nothing;
alter table public.ai_settings enable row level security;
drop policy if exists "equipa_acesso_total" on public.ai_settings;
create policy "equipa_acesso_total" on public.ai_settings for all to authenticated using (true) with check (true);

-- 2) Contador diário ---------------------------------------------------------
create table if not exists public.ai_usage (
  day      date primary key,
  replies  int not null default 0
);
alter table public.ai_usage enable row level security;
drop policy if exists "equipa_le_uso" on public.ai_usage;
create policy "equipa_le_uso" on public.ai_usage for select to authenticated using (true);

-- Gasta 1 resposta da quota de hoje. Devolve false se o limite acabou.
create or replace function public.ai_take_quota()
returns boolean language plpgsql security definer set search_path = public as $$
declare
  lim  int;
  tz   text;
  d    date;
  used int;
begin
  select a.daily_limit, c.timezone into lim, tz
    from ai_settings a, clinic_settings c where a.id = 1 and c.id = 1;
  d := (now() at time zone tz)::date;
  insert into ai_usage (day, replies) values (d, 0) on conflict (day) do nothing;
  update ai_usage set replies = replies + 1
   where day = d and replies < lim
  returning replies into used;
  return used is not null;
end;
$$;

-- 3) Receber mensagem (substitui a lógica do handle_incoming) ---------------
--    Devolve: { customer_id, replies: [ids das respostas criadas], ask_ai }
create or replace function public.receive_message(
  p_phone   text,
  p_name    text,
  p_body    text,
  p_channel text default 'whatsapp'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg      clinic_settings%rowtype;
  cus      customers%rowtype;
  is_new   boolean := false;
  t        text := norm_text(trim(p_body));
  appt     record;
  reply    text;
  ids      uuid[] := '{}';
  v_phone  text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if v_phone = '' or coalesce(trim(p_body), '') = '' then
    return jsonb_build_object('customer_id', null, 'replies', '[]'::jsonb, 'ask_ai', false);
  end if;
  if p_channel not in ('whatsapp', 'simulador') then
    raise exception 'canal inválido: %', p_channel;
  end if;

  select * into cfg from clinic_settings where id = 1;

  -- cliente (cria se for um número novo)
  select * into cus from customers c where c.phone = v_phone;
  if not found then
    insert into customers (name, phone, channel, stage)
    values (nullif(trim(p_name), ''), v_phone, p_channel, 'novo')
    returning * into cus;
    is_new := true;
  else
    update customers
       set channel = p_channel,
           name = coalesce(customers.name, nullif(trim(p_name), ''))
     where id = cus.id
    returning * into cus;
  end if;

  insert into messages (customer_id, sender, body, channel, status)
  values (cus.id, 'cliente', left(trim(p_body), 2000), p_channel, 'recebida');

  -- resposta a um lembrete: 1 confirma, 2 remarca (mesmo com a recepção a atender)
  select a.id, a.starts_at, s.name as sname into appt
    from appointments a join services s on s.id = a.service_id
   where a.customer_id = cus.id and a.status = 'marcado'
     and a.reminder_sent_at is not null and a.starts_at > now()
   order by a.starts_at limit 1;

  if appt.id is not null and t in ('1', 'sim', 'confirmo', 'confirmar', 'confirmado', 'ok', 'pode ser') then
    update appointments set status = 'confirmado', confirmed_at = now() where id = appt.id;
    ids := ids || bot_say(cus.id, 'Obrigada! ✅ Sua presença está confirmada: ' || lower(appt.sname)
      || ' ' || fmt_when_pt(appt.starts_at) || '. Até lá! 💜');
    return jsonb_build_object('customer_id', cus.id, 'replies', to_jsonb(ids), 'ask_ai', false);
  end if;

  if appt.id is not null and (t = '2' or t like '%remarc%' or t like '%cancel%' or t like '%nao vou%') then
    update customers set needs_human = true, bot_paused = true where id = cus.id;
    ids := ids || bot_say(cus.id, 'Sem problema! A recepção vai falar com você agora para remarcar. 🙏');
    return jsonb_build_object('customer_id', cus.id, 'replies', to_jsonb(ids), 'ask_ai', false);
  end if;

  -- assistente desligada, ou a recepção assumiu: não responde
  if not coalesce(cfg.bot_enabled, true) or cus.bot_paused then
    update customers set needs_human = true where id = cus.id;
    return jsonb_build_object('customer_id', cus.id, 'replies', '[]'::jsonb, 'ask_ai', false);
  end if;

  -- pedido para falar com uma pessoa
  if t ~ '(atendente|humano|pessoa|recepc|falar com alguem|reclama|gerente)' then
    update customers set needs_human = true, bot_paused = true where id = cus.id;
    ids := ids || bot_say(cus.id, 'Claro! Vou chamar a nossa recepção para falar com você. Em instantes alguém responde por aqui. 🙏');
    return jsonb_build_object('customer_id', cus.id, 'replies', to_jsonb(ids), 'ask_ai', false);
  end if;

  -- IA ligada e ainda há quota hoje: a IA responde
  if (select enabled from ai_settings where id = 1) and ai_take_quota() then
    return jsonb_build_object('customer_id', cus.id, 'replies', '[]'::jsonb, 'ask_ai', true);
  end if;

  -- sem IA: respostas por palavras-chave
  if t ~ '(preco|valor|quanto|custa|tabela|promoc)' then
    select 'Nossos serviços:' || chr(10) || string_agg(
             '• ' || s.name || ': ' ||
             case when s.price = 0 then 'gratuito'
                  else 'R$ ' || translate(to_char(s.price, 'FM999,990.00'), ',.', '.,')
             end || ' (' || s.duration_min || ' min)', chr(10) order by s.price, s.name)
           || chr(10) || chr(10) || 'Quer agendar algum? É só me dizer qual. 😊'
      into reply from services s where s.active;
    ids := ids || bot_say(cus.id, reply);
  elsif t ~ '(endereco|onde fica|onde voces|localiza|como chego|estacion|metro)' then
    ids := ids || bot_say(cus.id, 'Ficamos em ' || coalesce(cfg.address, 'São Paulo') || '. 📍 Quer agendar uma visita?');
  elsif t ~ '(horario de|que horas|abre|fecha|funcionamento|aberto|sabado|domingo)' then
    select 'Nosso horário:' || chr(10) || string_agg(
             '• ' || (array['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'])[h.weekday + 1] || ': ' ||
             case when h.is_open
                  then to_char(h.open_time, 'FMHH24"h"MI') || '–' || to_char(h.close_time, 'FMHH24"h"MI')
                  else 'fechado' end,
             chr(10) order by (h.weekday + 6) % 7)
      into reply from business_hours h;
    ids := ids || bot_say(cus.id, replace(reply, 'h00', 'h'));
  elsif t ~ '(agend|marcar|consulta|disponi|vaga|horario livre|horarios livres)' then
    update customers set needs_human = true where id = cus.id;
    ids := ids || bot_say(cus.id, 'Ótimo! 😊 Me diga qual serviço e o melhor dia para você, que a recepção confirma o horário em instantes.');
  elsif is_new then
    ids := ids || bot_say(cus.id, coalesce(cfg.welcome_message, 'Olá! 👋 Bem-vinda à ' || cfg.name || '. Como posso ajudar?'));
  else
    update customers set needs_human = true where id = cus.id;
    if not exists (select 1 from messages m where m.customer_id = cus.id and m.sender = 'bot'
                   and m.created_at > now() - interval '30 minutes') then
      ids := ids || bot_say(cus.id, 'Recebi sua mensagem! 😊 A recepção responde em instantes. Enquanto isso, posso informar preços, endereço ou horários.');
    end if;
  end if;

  return jsonb_build_object('customer_id', cus.id, 'replies', to_jsonb(ids), 'ask_ai', false);
end;
$$;

-- O antigo handle_incoming passa a usar o receive_message
create or replace function public.handle_incoming(
  p_phone text, p_name text, p_body text, p_channel text default 'whatsapp'
)
returns setof uuid language sql security definer set search_path = public as $$
  select (jsonb_array_elements_text(receive_message(p_phone, p_name, p_body, p_channel)->'replies'))::uuid;
$$;

-- 4) Permissões --------------------------------------------------------------
revoke execute on function public.receive_message(text, text, text, text) from public, anon;
revoke execute on function public.ai_take_quota() from public, anon, authenticated;
grant execute on function public.receive_message(text, text, text, text) to authenticated, service_role;
grant execute on function public.ai_take_quota() to service_role;

-- O servidor (Edge Functions) também precisa destas funções
grant execute on function public.handle_incoming(text, text, text, text) to service_role;
grant execute on function public.send_reminders(date) to service_role;
grant execute on function public.available_slots(uuid, date) to service_role;
grant execute on function public.bot_say(uuid, text) to service_role;
grant select on public.ai_usage to authenticated;
