// =====================================================================
//  whatsapp-send — envia pelo WhatsApp mensagens criadas no painel
//  (respostas da recepção e lembretes da véspera)
//
//  O painel chama esta função com { message_ids: [...] }.
//  Só funciona para quem tem login no painel.
//
//  Configuração no Supabase:
//   • "Verify JWT" LIGADO
//   • Secrets: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID
// =====================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

const env = (k: string) => Deno.env.get(k) ?? ''
const API_VERSION = env('WHATSAPP_API_VERSION') || 'v25.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const admin = createClient(
  env('SUPABASE_URL'),
  env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY'),
  { auth: { persistSession: false } },
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply({ error: 'Método não permitido' }, 405)

  // Confirmar que quem chama tem login no painel
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  const { data: auth } = await admin.auth.getUser(token)
  if (!auth?.user) return reply({ error: 'Sem login' }, 401)

  if (!env('WHATSAPP_TOKEN') || !env('WHATSAPP_PHONE_NUMBER_ID')) {
    return reply({ error: 'WhatsApp ainda não configurado (faltam os secrets).' }, 400)
  }

  const { message_ids } = await req.json().catch(() => ({ message_ids: [] }))
  const ids: string[] = Array.isArray(message_ids) ? message_ids.slice(0, 50) : []

  const results = []
  for (const id of ids) results.push(await send(id))
  return reply({ results })
})

async function send(messageId: string) {
  const { data: m } = await admin
    .from('messages')
    .select('id, body, channel, sender, customer:customers(phone)')
    .eq('id', messageId)
    .single()
  if (!m) return { id: messageId, ok: false, error: 'Mensagem não encontrada' }
  if (m.channel !== 'whatsapp' || m.sender === 'cliente') return { id: messageId, ok: true, skipped: true }

  const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${env('WHATSAPP_PHONE_NUMBER_ID')}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: (m.customer as any)?.phone,
      type: 'text',
      text: { body: m.body, preview_url: false },
    }),
  })
  const json = await res.json().catch(() => ({}))

  // Erro 131047: passaram mais de 24h desde a última mensagem do cliente.
  // A Meta só deixa enviar um "modelo" aprovado nesse caso.
  const error = res.ok
    ? null
    : json.error?.code === 131047
      ? 'Passaram mais de 24h desde a última mensagem do cliente: é preciso um modelo aprovado pela Meta.'
      : json.error?.message ?? `Erro ${res.status}`

  await admin
    .from('messages')
    .update(res.ok ? { status: 'enviada', wa_message_id: json.messages?.[0]?.id ?? null, error: null } : { status: 'falhou', error })
    .eq('id', messageId)

  return { id: messageId, ok: res.ok, error }
}
