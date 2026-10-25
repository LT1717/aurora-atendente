-- =====================================================================
--  Clínica Aurora Estética — Atendente IA
--  FICHEIRO 3: MENSAGENS (WhatsApp real + Simulador)
--  Cola tudo no SQL Editor do Supabase e carrega em "Run". Pode correr-se
--  mais do que uma vez sem estragar nada.
--
--  O que faz:
--   • guarda o canal de cada cliente (WhatsApp real ou Simulador)
--   • guarda o estado de cada mensagem enviada (pendente, enviada, falhou)
--   • handle_incoming(): o "cérebro" das respostas automáticas (sem IA):
--       - "1" confirma o agendamento depois do lembrete, "2" pede remarcação
--       - pedir atendente/recepção pausa o bot e avisa o painel
--       - perguntas sobre preços, endereço e horários têm resposta pronta
--       - mensagem de boas-vindas para números novos
--     Na fase B a IA entra no lugar das respostas por palavras-chave.
--   • send_reminders(): cria os lembretes da véspera
-- =====================================================================

-- 1) Canal do cliente e estado das mensagens ----------------------------
alter table public.customers
  add column if not exists channel text not null default 'simulador';
alter table public.customers drop constraint if exists customers_channel_check;
alter table public.customers
  add constraint customers_channel_check check (channel in ('whatsapp', 'simulador'));

alter table public.messages alter column channel set default 'simulador';
alter table public.messages add column if not exists status text;
alter table public.messages add column if not exists wa_message_id text;
alter table public.messages add column if not exists error text;
alter table public.messages drop constraint if exists messages_status_check;
alter table public.messages
  add constraint messages_status_check
  check (status is null or status in ('recebida', 'pendente', 'enviada', 'falhou', 'simulada'));

-- Os dados de exemplo são conversas simuladas, não WhatsApp real
update public.messages set channel = 'simulador'
 where customer_id in (select id from public.customers where channel = 'simulador');

-- 2) Ajudantes -----------------------------------------------------------

-- Tira acentos e põe em minúsculas, para comparar palavras
create or replace function public.norm_text(t text)
returns text language sql immutable as $$
  select translate(lower(coalesce(t, '')),
                   'áàâãäéèêëíìîïóòôõöúùûüç',
                   'aaaaaeeeeiiiiooooouuuuc');
$$;

-- "quinta-feira, 23/10 às 10:30" (hora de São Paulo)
create or replace function public.fmt_when_pt(ts timestamptz)
returns text language sql stable set search_path = public as $$
  select (array['domingo','segunda-feira','terça-feira','quarta-feira',
                'quinta-feira','sexta-feira','sábado'])
           [extract(dow from (ts at time zone c.timezone))::int + 1]
         || ', ' || to_char(ts at time zone c.timezone, 'DD/MM "às" HH24:MI')
    from clinic_settings c where c.id = 1;
$$;

-- Cria uma mensagem da assistente e devolve o id
create or replace function public.bot_say(p_customer uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_channel text;
  v_id uuid;
begin
  select channel into v_channel from customers where id = p_customer;
  insert into messages (customer_id, sender, body, channel, status)
  values (p_customer, 'bot', p_body, v_channel,
          case when v_channel = 'whatsapp' then 'pendente' else 'simulada' end)
  returning id into v_id;
  return v_id;
end;
$$;

-- 3) Mensagem que chega (do WhatsApp ou do Simulador) -------------------
--    Devolve os ids das respostas criadas. A Edge Function do WhatsApp
--    envia-as; no Simulador aparecem logo no ecrã.
create or replace function public.handle_incoming(
  p_phone   text,
  p_name    text,
  p_body    text,
  p_channel text default 'whatsapp'
)
returns setof uuid
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
  v_phone  text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if v_phone = '' or coalesce(trim(p_body), '') = '' then
    return;
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

  -- guardar a mensagem da cliente
  insert into messages (customer_id, sender, body, channel, status)
  values (cus.id, 'cliente', trim(p_body), p_channel, 'recebida');

  -- resposta a um lembrete pendente: 1 = confirma, 2 = remarcar
  -- (funciona mesmo que a recepção tenha assumido a conversa)
  select a.id, a.starts_at, s.name as sname into appt
    from appointments a join services s on s.id = a.service_id
   where a.customer_id = cus.id and a.status = 'marcado'
     and a.reminder_sent_at is not null and a.starts_at > now()
   order by a.starts_at limit 1;

  if appt.id is not null and t in ('1', 'sim', 'confirmo', 'confirmar', 'confirmado', 'ok', 'pode ser') then
    update appointments set status = 'confirmado', confirmed_at = now() where id = appt.id;
    return next bot_say(cus.id, 'Obrigada! ✅ Sua presença está confirmada: ' || lower(appt.sname)
      || ' ' || fmt_when_pt(appt.starts_at) || '. Até lá! 💜');
    return;
  end if;

  if appt.id is not null and (t = '2' or t like '%remarc%' or t like '%cancel%' or t like '%nao vou%') then
    update customers set needs_human = true, bot_paused = true where id = cus.id;
    return next bot_say(cus.id, 'Sem problema! A recepção vai falar com você agora para remarcar. 🙏');
    return;
  end if;

  -- assistente desligada, ou a recepção assumiu esta conversa: não responde
  if not coalesce(cfg.bot_enabled, true) or cus.bot_paused then
    update customers set needs_human = true where id = cus.id;
    return;
  end if;

  -- pedido para falar com uma pessoa (ou reclamação)
  if t ~ '(atendente|humano|pessoa|recepc|falar com alguem|reclama|gerente|nao entend)' then
    update customers set needs_human = true, bot_paused = true where id = cus.id;
    return next bot_say(cus.id, 'Claro! Vou chamar a nossa recepção para falar com você. Em instantes alguém responde por aqui. 🙏');
    return;
  end if;

  -- perguntas frequentes
  if t ~ '(preco|valor|quanto|custa|tabela|promoc)' then
    select 'Nossos serviços:' || chr(10) || string_agg(
             '• ' || s.name || ': ' ||
             case when s.price = 0 then 'gratuito'
                  else 'R$ ' || translate(to_char(s.price, 'FM999,990.00'), ',.', '.,')
             end || ' (' || s.duration_min || ' min)', chr(10) order by s.price, s.name)
           || chr(10) || chr(10) || 'Quer agendar algum? É só me dizer qual. 😊'
      into reply
      from services s where s.active;
    return next bot_say(cus.id, reply);
    return;
  end if;

  if t ~ '(endereco|onde fica|onde voces|localiza|como chego|estacion|metro)' then
    return next bot_say(cus.id, 'Ficamos em ' || coalesce(cfg.address, 'São Paulo') || '. 📍 Quer agendar uma visita?');
    return;
  end if;

  if t ~ '(horario de|que horas|abre|fecha|funcionamento|aberto|sabado|domingo)' then
    select 'Nosso horário:' || chr(10) || string_agg(
             '• ' || (array['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'])[h.weekday + 1] || ': ' ||
             case when h.is_open
                  then to_char(h.open_time, 'FMHH24"h"MI') || '–' || to_char(h.close_time, 'FMHH24"h"MI')
                  else 'fechado' end,
             chr(10) order by (h.weekday + 6) % 7)
      into reply
      from business_hours h;
    reply := replace(reply, 'h00', 'h');
    return next bot_say(cus.id, reply);
    return;
  end if;

  if t ~ '(agend|marcar|consulta|disponi|vaga|horario livre|horarios livres)' then
    update customers set needs_human = true where id = cus.id;
    return next bot_say(cus.id, 'Ótimo! 😊 Me diga qual serviço e o melhor dia para você, que a recepção confirma o horário em instantes.');
    return;
  end if;

  -- número novo: boas-vindas
  if is_new then
    return next bot_say(cus.id, coalesce(cfg.welcome_message,
      'Olá! 👋 Bem-vinda à ' || cfg.name || '. Como posso ajudar?'));
    return;
  end if;

  -- não percebeu: avisa a recepção (no máximo 1 resposta automática a cada 30 min)
  update customers set needs_human = true where id = cus.id;
  if not exists (select 1 from messages m where m.customer_id = cus.id and m.sender = 'bot'
                 and m.created_at > now() - interval '30 minutes') then
    return next bot_say(cus.id, 'Recebi sua mensagem! 😊 A recepção responde em instantes. Enquanto isso, posso informar preços, endereço ou horários.');
  end if;
end;
$$;

-- 4) Lembretes da véspera -------------------------------------------------
--    Cria um lembrete para cada agendamento "a confirmar" do dia indicado
--    (por defeito, amanhã) que ainda não recebeu lembrete.
create or replace function public.send_reminders(p_day date default null)
returns table (message_id uuid, channel text)
language plpgsql
security definer
set search_path = public
as $$
declare
  tz  text;
  d   date;
  r   record;
  mid uuid;
begin
  select timezone into tz from clinic_settings where id = 1;
  d := coalesce(p_day, (now() at time zone tz)::date + 1);

  for r in
    select a.id, a.customer_id, a.starts_at, s.name as sname, c.name as cname, c.channel as cchannel
      from appointments a
      join services s on s.id = a.service_id
      join customers c on c.id = a.customer_id
     where a.status = 'marcado' and a.reminder_sent_at is null
       and a.starts_at > now()
       and (a.starts_at at time zone tz)::date = d
     order by a.starts_at
  loop
    mid := bot_say(r.customer_id,
      'Oi' || coalesce(', ' || split_part(r.cname, ' ', 1), '') || '! Passando para lembrar: '
      || lower(r.sname) || ' ' || fmt_when_pt(r.starts_at)
      || ' na Clínica Aurora. Responda 1 para CONFIRMAR ou 2 para REMARCAR.');
    update appointments set reminder_sent_at = now() where id = r.id;
    message_id := mid;
    channel := r.cchannel;
    return next;
  end loop;
end;
$$;

-- 5) Permissões: só quem tem login (o painel) ou o servidor ---------------
revoke execute on function public.handle_incoming(text, text, text, text) from public, anon;
revoke execute on function public.send_reminders(date) from public, anon;
revoke execute on function public.bot_say(uuid, text) from public, anon, authenticated;
grant  execute on function public.handle_incoming(text, text, text, text) to authenticated;
grant  execute on function public.send_reminders(date) to authenticated;
