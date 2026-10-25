// =====================================================================
//  whatsapp-webhook — recebe as mensagens do WhatsApp (Meta)
//
//  A Meta chama este endereço sempre que um cliente escreve.
//  1) GET  → a Meta confirma o webhook (verify token)
//  2) POST → mensagem nova: guarda-a, decide a resposta (handle_incoming)
//            e envia a resposta pelo WhatsApp
//
//  Configuração no Supabase:
//   • "Verify JWT" DESLIGADO (a Meta não envia login do Supabase)
//   • Secrets: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
//              WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET
// =====================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

const env = (k: string) => Deno.env.get(k) ?? ''
const API_VERSION = env('WHATSAPP_API_VERSION') || 'v25.0'

const db = createClient(
  env('SUPABASE_URL'),
  env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY'),
  { auth: { persistSession: false } },
)

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // 1) Verificação do webhook pela Meta
  if (req.method === 'GET') {
    const ok =
      url.searchParams.get('hub.mode') === 'subscribe' &&
      url.searchParams.get('hub.verify_token') === env('WHATSAPP_VERIFY_TOKEN')
    return ok
      ? new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 })
      : new Response('Verify token incorreto', { status: 403 })
  }

  if (req.method !== 'POST') return new Response('Método não permitido', { status: 405 })

  // 2) Confirmar que o pedido vem mesmo da Meta (assinatura)
  const raw = await req.text()
  if (!(await validSignature(raw, req.headers.get('x-hub-signature-256')))) {
    return new Response('Assinatura inválida', { status: 401 })
  }

  let payload: any
  try {
    payload = JSON.parse(raw)
  } catch {
    return new Response('ok')
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {}

      // estados das mensagens enviadas (entregue, lida, falhou)
      for (const st of value.statuses ?? []) {
        if (st.status === 'failed') {
          await db
            .from('messages')
            .update({ status: 'falhou', error: st.errors?.[0]?.title ?? 'Falha no envio' })
            .eq('wa_message_id', st.id)
        }
      }

      // mensagens novas dos clientes
      for (const msg of value.messages ?? []) {
        const name = value.contacts?.find((c: any) => c.wa_id === msg.from)?.profile?.name ?? ''
        const body = textOf(msg)
        try {
          const { data: replyIds, error } = await db.rpc('handle_incoming', {
            p_phone: msg.from,
            p_name: name,
            p_body: body,
            p_channel: 'whatsapp',
          })
          if (error) throw error
          for (const id of replyIds ?? []) await sendMessage(id)
        } catch (err) {
          console.error('Erro a processar mensagem', err)
        }
      }
    }
  }

  // Responder sempre 200 depressa, senão a Meta repete o envio
  return new Response('ok')
})

/** Texto da mensagem; áudios, fotos, etc. ficam com uma etiqueta */
function textOf(msg: any): string {
  switch (msg.type) {
    case 'text':
      return msg.text?.body ?? ''
    case 'button':
      return msg.button?.text ?? ''
    case 'interactive':
      return msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? '[resposta]'
    case 'audio':
      return '[áudio]'
    case 'image':
      return msg.image?.caption ? `[foto] ${msg.image.caption}` : '[foto]'
    case 'video':
      return '[vídeo]'
    case 'document':
      return '[documento]'
    case 'location':
      return '[localização]'
    case 'sticker':
      return '[figurinha]'
    default:
      return `[${msg.type}]`
  }
}

/** Envia pelo WhatsApp uma mensagem já gravada na tabela messages */
async function sendMessage(messageId: string) {
  const { data: m } = await db
    .from('messages')
    .select('id, body, channel, customer:customers(phone)')
    .eq('id', messageId)
    .single()
  if (!m || m.channel !== 'whatsapp') return

  const res = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${env('WHATSAPP_PHONE_NUMBER_ID')}/messages`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: (m.customer as any)?.phone,
        type: 'text',
        text: { body: m.body, preview_url: false },
      }),
    },
  )
  const json = await res.json().catch(() => ({}))
  await db
    .from('messages')
    .update(
      res.ok
        ? { status: 'enviada', wa_message_id: json.messages?.[0]?.id ?? null, error: null }
        : { status: 'falhou', error: json.error?.message ?? `Erro ${res.status}` },
    )
    .eq('id', messageId)
}

/** Assinatura HMAC-SHA256 que a Meta envia no cabeçalho x-hub-signature-256 */
async function validSignature(raw: string, header: string | null): Promise<boolean> {
  const secret = env('WHATSAPP_APP_SECRET')
  if (!secret) return true // sem App Secret configurado, não valida (só para testes)
  if (!header?.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const expected = header.slice(7)
  if (hex.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}
