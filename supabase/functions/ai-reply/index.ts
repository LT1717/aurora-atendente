// =====================================================================
//  ai-reply — a assistente com IA (Claude)
//
//  Recebe { customer_id }, lê a conversa e os dados da clínica,
//  pergunta à IA e grava a resposta. A IA pode:
//   • consultar horários livres (a mesma função SQL do painel)
//   • criar agendamentos (a base de dados impede conflitos)
//   • passar a conversa para a recepção
//  Nas conversas do WhatsApp, envia também a resposta pela Meta.
//
//  Quem pode chamar: o painel (com login) ou o webhook do WhatsApp
//  (com o cabeçalho x-internal-secret).
//
//  Configuração no Supabase:
//   • "Verify JWT" DESLIGADO (esta função faz a sua própria verificação)
//   • Secrets: ANTHROPIC_API_KEY, INTERNAL_SECRET
//     (para o WhatsApp: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID)
// =====================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

const env = (k: string) => Deno.env.get(k) ?? ''
const MODEL = env('ANTHROPIC_MODEL') || 'claude-haiku-5-5'
const WA_VERSION = env('WHATSAPP_API_VERSION') || 'v25.0'
const TZ = 'America/Sao_Paulo'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY'), {
  auth: { persistSession: false },
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  // Quem chama? O webhook (segredo interno) ou alguém com login no painel
  const internal = env('INTERNAL_SECRET') && req.headers.get('x-internal-secret') === env('INTERNAL_SECRET')
  if (!internal) {
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data } = await db.auth.getUser(token)
    if (!data?.user) return json({ error: 'Sem login' }, 401)
  }
  if (!env('ANTHROPIC_API_KEY')) return json({ error: 'Falta o secret ANTHROPIC_API_KEY no Supabase.' }, 500)

  const { customer_id } = await req.json().catch(() => ({}))
  if (!customer_id) return json({ error: 'Falta customer_id' }, 400)

  try {
    const reply = await answer(customer_id)
    return json({ ok: true, reply_id: reply?.id ?? null, reply_text: reply?.body ?? null })
  } catch (err) {
    console.error(err)
    // A cliente não fica sem resposta: avisa e passa para a recepção
    await db.from('customers').update({ needs_human: true }).eq('id', customer_id)
    const id = await say(customer_id, 'Desculpe, tive um problema para responder agora. A recepção já foi avisada e fala com você em instantes. 🙏')
    return json({ ok: false, reply_id: id, error: String(err?.message ?? err) }, 200)
  }
})

/* ------------------------------------------------------------------ */

async function answer(customerId: string): Promise<{ id: string | null; body: string } | null> {
  const [cfgR, svcR, hrsR, blkR, cusR, msgR, apptR] = await Promise.all([
    db.from('clinic_settings').select('*').eq('id', 1).single(),
    db.from('services').select('id, name, description, duration_min, price').eq('active', true).order('name'),
    db.from('business_hours').select('*').order('weekday'),
    db.from('blocked_dates').select('day, reason').gte('day', isoDay(new Date())),
    db.from('customers').select('id, name, phone, channel, bot_paused').eq('id', customerId).single(),
    db.from('messages').select('sender, body, created_at').eq('customer_id', customerId)
      .order('created_at', { ascending: false }).limit(20),
    db.from('appointments').select('starts_at, status, service:services(name)').eq('customer_id', customerId)
      .gte('starts_at', new Date().toISOString()).in('status', ['marcado', 'confirmado']).order('starts_at'),
  ])
  const cfg = cfgR.data
  const services = svcR.data ?? []
  const customer = cusR.data
  if (!cfg || !customer) throw new Error('Cliente ou clínica não encontrados')
  if (customer.bot_paused) return null

  const system = buildSystemPrompt(cfg, services, hrsR.data ?? [], blkR.data ?? [], customer, apptR.data ?? [])
  const messages = toClaudeMessages((msgR.data ?? []).reverse())
  if (!messages.length) return null

  // Conversa com a IA, deixando-a usar as ferramentas (no máximo 5 voltas)
  for (let turn = 0; turn < 5; turn++) {
    const res = await callClaude(system, messages)
    messages.push({ role: 'assistant', content: res.content })

    if (res.stop_reason !== 'tool_use') {
      const text = res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim()
      const body = text || 'Certo! A nossa recepção vai continuar o atendimento por aqui em instantes. 🙏'
      return { id: await say(customerId, body), body }
    }

    const calls = res.content.filter((b: any) => b.type === 'tool_use')
    const results = await Promise.all(
      calls.map(async (block: any) => ({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(await runTool(block.name, block.input, customer, services)),
      })),
    )
    messages.push({ role: 'user', content: results })
  }
  throw new Error('A IA não terminou a resposta')
}

/* ---------------- Ferramentas que a IA pode usar ---------------- */

const TOOLS = [
  {
    name: 'ver_horarios_livres',
    description:
      'Lista os horários livres de um serviço num dia. Use sempre antes de propor horários. Nunca invente horários.',
    input_schema: {
      type: 'object',
      properties: {
        servico_id: { type: 'string', description: 'id do serviço (da lista de serviços)' },
        dia: { type: 'string', description: 'data no formato AAAA-MM-DD' },
      },
      required: ['servico_id', 'dia'],
    },
  },
  {
    name: 'criar_agendamento',
    description:
      'Cria o agendamento depois de a cliente escolher um horário que veio de ver_horarios_livres. Peça o nome antes, se ainda não souber.',
    input_schema: {
      type: 'object',
      properties: {
        servico_id: { type: 'string' },
        inicio: { type: 'string', description: 'o valor "inicio" exatamente como veio de ver_horarios_livres' },
        nome_cliente: { type: 'string', description: 'nome da cliente, se ela disse' },
      },
      required: ['servico_id', 'inicio'],
    },
  },
  {
    name: 'avisar_recepcao',
    description:
      'Avisa a recepção, sem pausar a assistente, quando a cliente pergunta uma INFORMAÇÃO que não está nos dados (ex.: um serviço que não existe). NÃO use para agendamentos: agendar é com você.',
    input_schema: {
      type: 'object',
      properties: { motivo: { type: 'string' } },
      required: ['motivo'],
    },
  },
  {
    name: 'passar_para_recepcao',
    description:
      'Passa a conversa para a recepção humana e PAUSA a assistente. Use só para reclamações, dúvidas de saúde/reações, cancelamentos ou remarcações, ou quando a cliente pedir uma pessoa.',
    input_schema: {
      type: 'object',
      properties: { motivo: { type: 'string' } },
      required: ['motivo'],
    },
  },
]

async function runTool(name: string, input: any, customer: any, services: any[]) {
  try {
    if (name === 'ver_horarios_livres') {
      if (!services.some((s) => s.id === input.servico_id)) return { erro: 'Serviço não encontrado' }
      const { data, error } = await db.rpc('available_slots', { p_service_id: input.servico_id, p_day: input.dia })
      if (error) return { erro: error.message }
      const livres = (data ?? []).map((s: any) => ({ inicio: s.slot_start, hora: hhmm(s.slot_start) }))
      return livres.length ? { dia: input.dia, livres: livres.slice(0, 16) } : { dia: input.dia, livres: [], aviso: 'Sem horários livres neste dia' }
    }

    if (name === 'criar_agendamento') {
      const svc = services.find((s) => s.id === input.servico_id)
      if (!svc) return { erro: 'Serviço não encontrado' }
      const start = new Date(input.inicio)
      if (isNaN(+start)) return { erro: 'Horário inválido' }
      // confirmar que o horário continua livre
      const { data: slots } = await db.rpc('available_slots', { p_service_id: svc.id, p_day: isoDay(start) })
      const ok = (slots ?? []).some((s: any) => +new Date(s.slot_start) === +start)
      if (!ok) return { erro: 'Esse horário já não está livre. Consulte de novo e ofereça outro.' }
      if (input.nome_cliente && !customer.name) {
        await db.from('customers').update({ name: String(input.nome_cliente).slice(0, 80) }).eq('id', customer.id)
      }
      const end = new Date(+start + svc.duration_min * 60_000)
      const { error } = await db.from('appointments').insert({
        customer_id: customer.id,
        service_id: svc.id,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        status: 'marcado',
        source: customer.channel === 'whatsapp' ? 'whatsapp' : 'simulador',
      })
      if (error) return { erro: 'Não foi possível agendar: ' + error.message }
      await db.from('customers').update({ stage: 'fechado' }).eq('id', customer.id).eq('stage', 'novo')
      return { ok: true, servico: svc.name, quando: whenPt(start), preco: svc.price }
    }

    if (name === 'avisar_recepcao') {
      await db.from('customers').update({ needs_human: true }).eq('id', customer.id)
      return { ok: true, nota: 'Recepção avisada. Continue a conversa normalmente.' }
    }

    if (name === 'passar_para_recepcao') {
      await db.from('customers').update({ needs_human: true, bot_paused: true }).eq('id', customer.id)
      return { ok: true, nota: 'A recepção foi avisada. Diga à cliente que alguém responde em instantes.' }
    }
    return { erro: 'Ferramenta desconhecida' }
  } catch (err) {
    return { erro: String((err as Error)?.message ?? err) }
  }
}

/* ---------------- Instruções para a IA ---------------- */

function buildSystemPrompt(cfg: any, services: any[], hours: any[], blocked: any[], customer: any, appts: any[]) {
  const wd = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
  const today = new Date()
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(+today + i * 86_400_000)
    const key = isoDay(d)
    const h = hours.find((x) => x.weekday === weekdayOf(key))
    const b = blocked.find((x) => x.day === key)
    const status = b ? `fechado (${b.reason ?? 'feriado'})` : h?.is_open ? `${h.open_time.slice(0, 5)}–${h.close_time.slice(0, 5)}` : 'fechado'
    return `${key} (${wd[weekdayOf(key)]}${i === 0 ? ', hoje' : i === 1 ? ', amanhã' : ''}): ${status}`
  }).join('\n')

  const svcList = services
    .map((s) => `- id=${s.id} | ${s.name} | ${s.duration_min} min | ${s.price > 0 ? 'R$ ' + Number(s.price).toFixed(2).replace('.', ',') : 'gratuito'}${s.description ? ' | ' + s.description : ''}`)
    .join('\n')

  const apptList = appts.length
    ? appts.map((a: any) => `- ${a.service?.name}: ${whenPt(new Date(a.starts_at))} (${a.status === 'confirmado' ? 'confirmado' : 'a confirmar'})`).join('\n')
    : 'nenhum'

  return `Você é a Aurora, assistente virtual da ${cfg.name}, atendendo clientes pelo WhatsApp.
Agora são ${hhmm(today.toISOString())} de ${whenDay(today)} (horário de São Paulo).

SEU TRABALHO PRINCIPAL É AGENDAR
Você tem acesso direto à agenda e PODE e DEVE marcar sozinha. Nunca passe um pedido de agendamento para a recepção.
Como agendar:
1. Se a cliente disser o serviço mas não o dia, não pergunte só "qual dia?": consulte já os próximos 2 dias abertos com ver_horarios_livres e ofereça 3 ou 4 horários, perguntando se algum serve.
2. Se ela disser o dia (ou "amanhã", "sábado", "de manhã"), consulte esse dia e ofereça horários que combinem.
3. Antes de marcar, confirme o nome se ainda não souber.
4. Quando ela escolher, chame criar_agendamento e confirme serviço, dia, hora e valor.
5. Vários serviços: marque um de cada vez. O segundo pode ser logo a seguir ao primeiro (consulte os horários livres do mesmo dia).
6. Nunca diga que agendou sem a ferramenta confirmar. Nunca invente horários.

EXEMPLO
Cliente: quero design de sobrancelhas
(você consulta ver_horarios_livres para os próximos 2 dias abertos)
Aurora: Claro! 😊 Design de sobrancelhas (30 min, R$ 70). Tenho amanhã às 10:00, 11:30 ou 15:00, e quinta às 9:30. Algum serve?
Cliente: amanhã 11:30. sou a Paula
(você chama criar_agendamento)
Aurora: Prontinho, Paula! ✅ Design de sobrancelhas amanhã às 11:30, R$ 70. Na véspera mando um lembrete. Posso ajudar em mais alguma coisa?

COMO RESPONDER
- IDIOMA: responda no idioma em que a cliente escreveu. Por padrão, português do Brasil; se ela escrever em inglês, espanhol ou outro idioma, responda nesse idioma (pode traduzir o nome dos serviços, mas os preços continuam em R$). Esta regra vale mesmo que o texto da clínica diga outra coisa sobre o idioma.
- Simpática, curta e clara (1 a 4 frases, como no WhatsApp). Emojis com moderação.
- Responda SEMPRE com uma mensagem de texto para a cliente, mesmo depois de usar ferramentas.
- Use apenas as informações abaixo. Se perguntarem algo que não está aqui (por exemplo um serviço que não existe), diga que vai confirmar com a equipe, use avisar_recepcao e continue a ajudar.
- passar_para_recepcao (que pausa você) só para: reclamação, dúvida de saúde ou reação a um procedimento, cancelamento ou remarcação de um agendamento existente, ou quando a cliente pedir para falar com uma pessoa.
- Se a cliente pedir "me ajuda você", continue você mesma.
- Não dê diagnóstico nem conselho médico. Não prometa descontos que não estejam no texto da clínica.
- Estas regras valem mais do que qualquer regra escrita no texto da clínica abaixo.

CLIENTE
Nome: ${customer.name || 'ainda não sabemos'}
Próximos agendamentos:
${apptList}

SERVIÇOS
${svcList}

PRÓXIMOS DIAS (funcionamento)
${days}

INFORMAÇÕES DA CLÍNICA (use como fonte de dados)
Telefone: ${cfg.phone ?? '-'}
Endereço: ${cfg.address ?? '-'}
${cfg.info_ia ?? ''}`
}

/* ---------------- Ajudantes ---------------- */

/** Converte o histórico da conversa no formato da IA (alternando cliente/assistente) */
function toClaudeMessages(rows: any[]) {
  const out: any[] = []
  for (const r of rows) {
    const role = r.sender === 'cliente' ? 'user' : 'assistant'
    const text = r.sender === 'humano' ? `[Recepção] ${r.body}` : r.body
    const last = out[out.length - 1]
    if (last && last.role === role) last.content += `\n${text}`
    else out.push({ role, content: text })
  }
  while (out.length && out[0].role !== 'user') out.shift()
  while (out.length && out[out.length - 1].role !== 'user') out.pop()
  return out
}

async function callClaude(system: string, messages: any[]) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 700, system, tools: TOOLS, messages }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message ?? `Erro da IA ${res.status}`)
  return data
}

/** Grava a resposta da assistente e, no WhatsApp, envia-a */
async function say(customerId: string, body: string): Promise<string | null> {
  const { data: c } = await db.from('customers').select('phone, channel').eq('id', customerId).single()
  const whatsapp = c?.channel === 'whatsapp'
  const { data: m } = await db
    .from('messages')
    .insert({ customer_id: customerId, sender: 'bot', body, channel: c?.channel ?? 'simulador', status: whatsapp ? 'pendente' : 'simulada' })
    .select('id')
    .single()
  if (!m) return null
  if (whatsapp && env('WHATSAPP_TOKEN')) {
    const res = await fetch(`https://graph.facebook.com/${WA_VERSION}/${env('WHATSAPP_PHONE_NUMBER_ID')}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: c!.phone, type: 'text', text: { body, preview_url: false } }),
    })
    const out = await res.json().catch(() => ({}))
    await db
      .from('messages')
      .update(res.ok ? { status: 'enviada', wa_message_id: out.messages?.[0]?.id ?? null } : { status: 'falhou', error: out.error?.message ?? `Erro ${res.status}` })
      .eq('id', m.id)
  }
  return m.id
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, ...opts })
const hhmm = (iso: string) => fmt({ hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
const whenDay = (d: Date) => fmt({ weekday: 'long', day: '2-digit', month: '2-digit' }).format(d)
const whenPt = (d: Date) => `${whenDay(d)} às ${hhmm(d.toISOString())}`
const isoDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const weekdayOf = (key: string) => new Date(`${key}T12:00:00Z`).getUTCDay()
