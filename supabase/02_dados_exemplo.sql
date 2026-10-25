-- =====================================================================
--  Clínica Aurora Estética — Atendente IA
--  FICHEIRO 2 de 2: DADOS DE EXEMPLO (todos fictícios)
--  Cola tudo no SQL Editor do Supabase e carrega em "Run".
--
--  Cria a função reset_demo_data(), que APAGA tudo e volta a pôr
--  os dados de exemplo, com datas à volta do dia de hoje.
--  Podes correr este ficheiro as vezes que quiseres.
--  O botão "Repor dados de demonstração" do painel usa a mesma função.
-- =====================================================================

create or replace function public.reset_demo_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tz          text := 'America/Sao_Paulo';
  today_local date;
  d           date;
  open_days   date[] := '{}';
  i           int;
  j           int;
  k           int;
  svc_ids     uuid[];
  cus_ids     uuid[];
  t_time      time;
  t_svc       int;
  st          timestamptz;
  en          timestamptz;
  dur         int;
  close_t     time;
  stt         text;
  day_idx     int;
  next_day    date;
  -- modelos de agenda por dia: "hora|nº do serviço"
  tpl         text[] := array[
    '09:00|2,10:30|5,13:00|3,15:00|6,17:00|8',
    '09:30|4,11:00|1,14:00|7,16:00|2',
    '10:00|9,11:00|5,13:30|6,18:00|8'
  ];
  part        text;
  r_appt      record;
  r_cus       record;
  wd          text[] := array['domingo','segunda-feira','terça-feira','quarta-feira',
                              'quinta-feira','sexta-feira','sábado'];
  wdp         text[] := array['no domingo','na segunda-feira','na terça-feira','na quarta-feira',
                              'na quinta-feira','na sexta-feira','no sábado'];
begin
  -- 1) Limpar tudo
  delete from messages where true;
  delete from appointments where true;
  delete from customers where true;
  delete from services where true;
  delete from blocked_dates where true;
  delete from business_hours where true;
  delete from clinic_settings where true;

  -- 2) Clínica
  insert into clinic_settings (id, name, phone, address, timezone, slot_interval_min,
                               welcome_message, info_ia, bot_enabled)
  values (1,
    'Clínica Aurora Estética',
    '+55 (11) 4002-8922',
    'Rua Oscar Freire, 1200 – sala 304, Jardins, São Paulo – SP, 01426-001',
    tz, 30,
    'Olá! 👋 Sou a Aurora, assistente virtual da Clínica Aurora Estética. Posso tirar dúvidas, ver horários livres e marcar o seu atendimento. Como posso ajudar?',
$txt$SOBRE A CLÍNICA
A Clínica Aurora Estética fica nos Jardins, em São Paulo. Atendemos com hora marcada. Equipe: esteticistas formadas e uma dermatologista (Dra. Helena Prado, CRM-SP fictício) para procedimentos injetáveis.

ENDEREÇO E COMO CHEGAR
Rua Oscar Freire, 1200 – sala 304, Jardins, São Paulo – SP. A 7 minutos a pé da estação Oscar Freire (linha 4-Amarela). Estacionamento conveniado no prédio: R$ 15 a primeira hora.

HORÁRIO
Segunda a sexta: 9h às 19h (intervalo das 12h às 13h). Sábado: 9h às 14h. Domingo e feriados: fechado.

PAGAMENTO
Pix, cartão de débito e crédito (até 3x sem juros acima de R$ 300). Não aceitamos cheque.

POLÍTICA DE REMARCAÇÃO
Remarcações ou cancelamentos sem custo até 24h antes. Faltas sem aviso: na próxima marcação é cobrado um sinal de 30%.

PERGUNTAS FREQUENTES
- A avaliação é gratuita e dura 30 minutos. Recomendamos para quem nunca fez procedimentos conosco.
- Limpeza de pele: indicada a cada 30 a 45 dias. Evitar sol forte por 48h depois.
- Peeling químico: não é indicado para gestantes. Pode deixar a pele vermelha por 2 a 3 dias.
- Depilação a laser: são necessárias em média 8 a 10 sessões. Não pode tomar sol 15 dias antes.
- Toxina botulínica: feita apenas pela dermatologista, após avaliação. Resultado em 7 a 15 dias.
- Pacotes: 4 sessões de drenagem linfática por R$ 520 (economia de R$ 80).

REGRAS PARA A ASSISTENTE
Responder sempre em português do Brasil, de forma simpática e curta. Agendar diretamente nos horários livres. Não dar diagnóstico médico. Reclamações, dúvidas de saúde ou pedido para falar com uma pessoa: passar para a recepção.$txt$,
    true);

  -- 3) Horário de funcionamento (0 = domingo)
  insert into business_hours (weekday, is_open, open_time, close_time, break_start, break_end) values
    (0, false, '09:00', '18:00', null, null),
    (1, true,  '09:00', '19:00', '12:00', '13:00'),
    (2, true,  '09:00', '19:00', '12:00', '13:00'),
    (3, true,  '09:00', '19:00', '12:00', '13:00'),
    (4, true,  '09:00', '19:00', '12:00', '13:00'),
    (5, true,  '09:00', '19:00', '12:00', '13:00'),
    (6, true,  '09:00', '14:00', null, null);

  -- 4) Feriados
  insert into blocked_dates (day, reason) values
    ('2026-11-02', 'Finados'),
    ('2026-11-20', 'Dia da Consciência Negra'),
    ('2026-12-25', 'Natal'),
    ('2027-01-01', 'Ano Novo');

  -- 5) Serviços (a ordem importa para os modelos de agenda acima)
  with ins as (
    insert into services (name, description, duration_min, price) values
      ('Avaliação estética',             'Primeira consulta para montar o plano de tratamento. Gratuita.',            30,    0),
      ('Limpeza de pele profunda',       'Higienização, extração, máscara calmante e protetor solar.',                60,  180),
      ('Peeling químico',                'Renovação da pele com ácidos. Indicado para manchas e textura.',            45,  250),
      ('Microagulhamento',               'Estímulo de colágeno para cicatrizes de acne e linhas finas.',              60,  350),
      ('Drenagem linfática',             'Massagem manual para reduzir inchaço e retenção de líquidos.',              60,  150),
      ('Massagem relaxante',             'Massagem corporal com óleos essenciais.',                                   60,  160),
      ('Depilação a laser – axilas',     'Laser de diodo. Pacotes para outras áreas na avaliação.',                   30,  120),
      ('Design de sobrancelhas',         'Design com pinça e linha. Henna opcional (+R$ 20).',                        30,   70),
      ('Toxina botulínica',              'Aplicação feita pela dermatologista, após avaliação. Valor por região.',   30, 1200)
    returning id, name
  )
  select array_agg(id order by array_position(array[
      'Avaliação estética','Limpeza de pele profunda','Peeling químico','Microagulhamento',
      'Drenagem linfática','Massagem relaxante','Depilação a laser – axilas',
      'Design de sobrancelhas','Toxina botulínica'], name))
    into svc_ids from ins;

  -- 6) Clientes (nomes e telefones fictícios)
  with ins as (
    insert into customers (name, phone, stage, notes, created_at) values
      ('Ana Beatriz Souza',  '5511987650101', 'fechado',   'Prefere horários de manhã.',              now() - interval '60 days'),
      ('Camila Ferreira',    '5511987650102', 'orcamento', 'Pediu orçamento de pacote de laser.',     now() - interval '3 days'),
      ('Juliana Oliveira',   '5511987650103', 'fechado',   null,                                      now() - interval '45 days'),
      ('Mariana Costa',      '5511987650104', 'fechado',   'Pele sensível. Evitar ácidos fortes.',    now() - interval '90 days'),
      ('Fernanda Lima',      '5511987650105', 'novo',      null,                                      now() - interval '1 day'),
      ('Patrícia Almeida',   '5511987650106', 'fechado',   null,                                      now() - interval '30 days'),
      ('Larissa Rocha',      '5511987650107', 'orcamento', null,                                      now() - interval '5 days'),
      ('Beatriz Martins',    '5511987650108', 'fechado',   'Cliente desde 2025.',                     now() - interval '120 days'),
      ('Rafaela Gomes',      '5511987650109', 'novo',      null,                                      now() - interval '2 days'),
      ('Carolina Ribeiro',   '5511987650110', 'fechado',   null,                                      now() - interval '20 days'),
      ('Thiago Carvalho',    '5511987650111', 'fechado',   null,                                      now() - interval '15 days'),
      ('Lucas Mendes',       '5511987650112', 'fechado',   null,                                      now() - interval '40 days'),
      ('Gabriela Dias',      '5511987650113', 'fechado',   null,                                      now() - interval '10 days'),
      ('Renata Barbosa',     '5511987650114', 'novo',      null,                                      now() - interval '6 hours')
    returning id, phone
  )
  select array_agg(id order by phone) into cus_ids from ins;

  -- 7) Dias de atendimento à volta de hoje: 4 para trás, hoje, 6 para a frente
  today_local := (now() at time zone tz)::date;

  d := today_local;
  i := 0;
  while i < 4 loop
    d := d - 1;
    if exists (select 1 from business_hours where weekday = extract(dow from d)::int and is_open)
       and not exists (select 1 from blocked_dates where day = d) then
      open_days := d || open_days;
      i := i + 1;
    end if;
  end loop;

  d := today_local;
  i := 0;
  while i < 7 loop
    if exists (select 1 from business_hours where weekday = extract(dow from d)::int and is_open)
       and not exists (select 1 from blocked_dates where day = d) then
      open_days := open_days || d;
      i := i + 1;
    end if;
    d := d + 1;
  end loop;

  select min(x) into next_day from unnest(open_days) x where x > today_local;

  -- 8) Marcações
  k := 0;
  for day_idx in 1 .. array_length(open_days, 1) loop
    d := open_days[day_idx];
    select close_time into close_t from business_hours where weekday = extract(dow from d)::int;
    j := 0;
    foreach part in array string_to_array(tpl[((day_idx - 1) % 3) + 1], ',') loop
      j := j + 1;
      t_time := split_part(part, '|', 1)::time;
      t_svc  := split_part(part, '|', 2)::int;
      select duration_min into dur from services where id = svc_ids[t_svc];
      continue when t_time + make_interval(mins => dur) > close_t;   -- sábado fecha mais cedo

      st := (d + t_time) at time zone tz;
      en := st + make_interval(mins => dur);
      k  := k + 1;

      if en <= now() then
        stt := case when k % 9 = 0 then 'faltou' when k % 7 = 0 then 'cancelado' else 'concluido' end;
      elsif d = today_local then
        stt := 'confirmado';
      elsif d = next_day then          -- próximo dia de atendimento: metade já confirmou
        stt := case when j % 2 = 1 then 'confirmado' else 'marcado' end;
      else
        stt := case when k % 5 = 0 then 'cancelado' else 'marcado' end;
      end if;

      insert into appointments (customer_id, service_id, starts_at, ends_at, status, source,
                                reminder_sent_at, confirmed_at, created_at)
      values (
        cus_ids[((k - 1) % array_length(cus_ids, 1)) + 1],
        svc_ids[t_svc], st, en, stt,
        case when k % 3 = 0 then 'painel' else 'whatsapp' end,
        case when d < next_day  then st - interval '1 day'
             when d = next_day  then now() - interval '3 hours' end,
        case when stt in ('confirmado','concluido') then least(now() - interval '2 hours', st - interval '20 hours') end,
        st - interval '5 days'
      );
    end loop;
  end loop;

  update appointments set reminder_sent_at = least(reminder_sent_at, now() - interval '3 hours')
   where reminder_sent_at is not null;

  -- 9) Conversas de exemplo

  -- 9.1 Dúvida de preço e morada (Camila)
  select * into r_cus from customers where phone = '5511987650102';
  insert into messages (customer_id, sender, body, created_at) values
    (r_cus.id, 'cliente', 'Oi, boa tarde! Quanto custa a depilação a laser?',                                   now() - interval '3 days 2 hours'),
    (r_cus.id, 'bot',     'Oi, Camila! 😊 A depilação a laser das axilas custa R$ 120 por sessão (30 min). Para outras áreas montamos um pacote na avaliação, que é gratuita. Quer que eu veja um horário para você?', now() - interval '3 days 2 hours' + interval '20 seconds'),
    (r_cus.id, 'cliente', 'Vocês ficam onde?',                                                                  now() - interval '3 days 1 hour 58 minutes'),
    (r_cus.id, 'bot',     'Ficamos na Rua Oscar Freire, 1200 – sala 304, nos Jardins. São 7 minutos a pé da estação Oscar Freire (linha amarela). Tem estacionamento conveniado no prédio.', now() - interval '3 days 1 hour 58 minutes' + interval '15 seconds'),
    (r_cus.id, 'cliente', 'Perfeito, vou ver minha agenda e volto a falar',                                     now() - interval '3 days 1 hour 50 minutes'),
    (r_cus.id, 'bot',     'Combinado! Estou por aqui quando quiser. 💜',                                         now() - interval '3 days 1 hour 50 minutes' + interval '10 seconds');

  -- 9.2 Marcação feita pelo WhatsApp (primeira marcação futura vinda do WhatsApp)
  select a.*, c.name as cname, s.name as sname, s.price as sprice
    into r_appt
    from appointments a join customers c on c.id = a.customer_id join services s on s.id = a.service_id
   where a.source = 'whatsapp' and a.starts_at > now() + interval '2 days' and a.status = 'marcado'
     and c.phone not in ('5511987650102','5511987650104','5511987650107','5511987650114')
   order by a.starts_at limit 1;
  if found then
    update appointments set created_at = now() - interval '1 day' where id = r_appt.id;
    insert into messages (customer_id, sender, body, created_at) values
      (r_appt.customer_id, 'cliente', 'Olá! Queria marcar ' || lower(r_appt.sname) || ' essa semana', now() - interval '1 day 5 minutes'),
      (r_appt.customer_id, 'bot', 'Olá, ' || split_part(r_appt.cname, ' ', 1) || '! Tenho horários livres ' ||
          wdp[extract(dow from (r_appt.starts_at at time zone tz))::int + 1] || ', dia ' ||
          to_char(r_appt.starts_at at time zone tz, 'DD/MM') || '. Qual prefere: ' ||
          to_char(r_appt.starts_at at time zone tz - interval '1 hour', 'HH24:MI') || ', ' ||
          to_char(r_appt.starts_at at time zone tz, 'HH24:MI') || ' ou mais tarde?', now() - interval '1 day 4 minutes'),
      (r_appt.customer_id, 'cliente', to_char(r_appt.starts_at at time zone tz, 'HH24"h"MI') || ' está ótimo', now() - interval '1 day 2 minutes'),
      (r_appt.customer_id, 'bot', 'Pronto! ✅ Agendei ' || lower(r_appt.sname) || ' para ' ||
          wd[extract(dow from (r_appt.starts_at at time zone tz))::int + 1] || ', ' ||
          to_char(r_appt.starts_at at time zone tz, 'DD/MM "às" HH24:MI') || '. Valor: R$ ' ||
          replace(to_char(r_appt.sprice, 'FM999990.00'), '.', ',') ||
          '. Na véspera envio um lembrete para você confirmar. 😊', now() - interval '1 day 1 minute');
  end if;

  -- 9.3 Lembrete da véspera + confirmação (primeira marcação confirmada do próximo dia)
  select a.*, c.name as cname, s.name as sname
    into r_appt
    from appointments a join customers c on c.id = a.customer_id join services s on s.id = a.service_id
   where (a.starts_at at time zone tz)::date = next_day and a.status = 'confirmado'
     and c.phone not in ('5511987650102','5511987650104','5511987650107','5511987650114')
     and a.customer_id not in (select customer_id from messages)
   order by a.starts_at limit 1;
  if found then
    update appointments
       set reminder_sent_at = now() - interval '2 hours', confirmed_at = now() - interval '1 hour 40 minutes'
     where id = r_appt.id;
    insert into messages (customer_id, sender, body, created_at) values
      (r_appt.customer_id, 'bot', 'Oi, ' || split_part(r_appt.cname, ' ', 1) || '! Passando para lembrar: ' ||
          lower(r_appt.sname) || ' ' ||
          case when (r_appt.starts_at at time zone tz)::date = today_local + 1 then 'amanhã'
               else wd[extract(dow from (r_appt.starts_at at time zone tz))::int + 1] end ||
          ' às ' || to_char(r_appt.starts_at at time zone tz, 'HH24:MI') ||
          ' na Clínica Aurora. Responda 1 para CONFIRMAR ou 2 para REMARCAR.', now() - interval '2 hours'),
      (r_appt.customer_id, 'cliente', '1', now() - interval '1 hour 40 minutes'),
      (r_appt.customer_id, 'bot', 'Obrigada! Sua presença está confirmada. Até lá! 💜', now() - interval '1 hour 40 minutes' + interval '5 seconds');
  end if;

  -- 9.4 Pedido de humano: o bot pausou e a recepção ainda não respondeu (Larissa)
  select * into r_cus from customers where phone = '5511987650107';
  insert into messages (customer_id, sender, body, created_at) values
    (r_cus.id, 'cliente', 'Boa tarde. Fiz peeling semana passada e a pele ainda está muito vermelha, é normal?', now() - interval '25 minutes'),
    (r_cus.id, 'bot',     'Oi, Larissa. Vermelhidão de 2 a 3 dias é esperada, mas como já passou mais tempo, o melhor é a nossa equipe avaliar. Vou passar a sua mensagem para a recepção agora mesmo. 🙏', now() - interval '25 minutes' + interval '15 seconds'),
    (r_cus.id, 'cliente', 'Ok, obrigada. Posso mandar foto?',                                                   now() - interval '22 minutes');
  update customers set bot_paused = true, needs_human = true where id = r_cus.id;

  -- 9.5 Recepção assumiu e já resolveu (Mariana)
  select * into r_cus from customers where phone = '5511987650104';
  insert into messages (customer_id, sender, body, created_at) values
    (r_cus.id, 'cliente', 'Vocês têm pacote para limpeza de pele? Queria falar com alguém sobre valores', now() - interval '2 days 4 hours'),
    (r_cus.id, 'bot',     'Claro, Mariana! Vou chamar alguém da recepção para conversar com você sobre pacotes. 😊', now() - interval '2 days 4 hours' + interval '12 seconds'),
    (r_cus.id, 'humano',  'Oi Mariana, aqui é a Bruna da recepção! Temos 3 limpezas por R$ 480. Como você tem pele sensível, a Dra. Helena sugere a versão sem ácidos. Quer reservar?', now() - interval '2 days 3 hours 40 minutes'),
    (r_cus.id, 'cliente', 'Quero sim! Pode fechar', now() - interval '2 days 3 hours 30 minutes'),
    (r_cus.id, 'humano',  'Fechado! Já deixei anotado no seu cadastro. 💜', now() - interval '2 days 3 hours 28 minutes');

  -- 9.6 Contacto novo, só a mensagem de boas-vindas (Renata)
  select * into r_cus from customers where phone = '5511987650114';
  insert into messages (customer_id, sender, body, created_at) values
    (r_cus.id, 'cliente', 'oi', now() - interval '6 hours'),
    (r_cus.id, 'bot',     'Olá! 👋 Sou a Aurora, assistente virtual da Clínica Aurora Estética. Posso tirar dúvidas, ver horários livres e marcar o seu atendimento. Como posso ajudar?', now() - interval '6 hours' + interval '5 seconds'),
    (r_cus.id, 'cliente', 'vcs fazem botox?', now() - interval '5 hours 59 minutes'),
    (r_cus.id, 'bot',     'Fazemos sim! A aplicação de toxina botulínica é feita pela nossa dermatologista, Dra. Helena, sempre depois de uma avaliação. O valor é a partir de R$ 1.200 por região. Quer marcar a avaliação gratuita?', now() - interval '5 hours 59 minutes' + interval '15 seconds');
end;
$$;

-- Só quem tem login pode repor os dados
revoke execute on function public.reset_demo_data() from public, anon;
grant  execute on function public.reset_demo_data() to authenticated;

-- Pôr os dados de exemplo agora
select public.reset_demo_data();
