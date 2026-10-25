// Todas as leituras e gravações na base de dados passam por aqui.
// As páginas nunca falam diretamente com o Supabase.
import { supabase } from './supabase'
import { addDays, dayRange, todayKey, weekdayOf } from './format'

async function run(promise) {
  const { data, error } = await promise
  if (error) throw error
  return data
}

/* ---------------- Memória rápida (cache) ----------------
   Cada leitura fica guardada 60 segundos. Voltar a uma página já vista
   é instantâneo. Qualquer gravação ou mensagem nova apaga a memória,
   para nunca mostrar dados antigos. */
const cache = new Map()
const TTL = 60_000

function cached(key, fetcher) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.promise
  const promise = fetcher().catch((err) => {
    cache.delete(key)
    throw err
  })
  cache.set(key, { at: Date.now(), promise })
  return promise
}

export const clearCache = () => cache.clear()

function write(promise) {
  cache.clear()
  return run(promise).finally(() => cache.clear())
}

/* ---------------- Sessão ---------------- */

export const signIn = (email, password) => run(supabase.auth.signInWithPassword({ email, password }))
export function signOut() {
  cache.clear()
  return supabase.auth.signOut()
}

/* ---------------- Clínica ---------------- */

export const getSettings = () =>
  cached('settings', () => run(supabase.from('clinic_settings').select('*').eq('id', 1).maybeSingle()))

export const saveSettings = (patch) =>
  write(supabase.from('clinic_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1))

export const resetDemo = () => write(supabase.rpc('reset_demo_data'))

/* ---------------- Serviços ---------------- */

export const listServices = () => cached('services', () => run(supabase.from('services').select('*').order('name')))

export function saveService(service) {
  const { id, ...fields } = service
  return id
    ? write(supabase.from('services').update(fields).eq('id', id))
    : write(supabase.from('services').insert(fields))
}

export const deleteService = (id) => write(supabase.from('services').delete().eq('id', id))

/* ---------------- Horários ---------------- */

export const listHours = () =>
  cached('hours', () => run(supabase.from('business_hours').select('*').order('weekday')))
export const saveHours = (rows) => write(supabase.from('business_hours').upsert(rows, { onConflict: 'weekday' }))

export const listBlocked = () => cached('blocked', () => run(supabase.from('blocked_dates').select('*').order('day')))
export const addBlocked = (day, reason) => write(supabase.from('blocked_dates').insert({ day, reason }))
export const removeBlocked = (id) => write(supabase.from('blocked_dates').delete().eq('id', id))

// Os horários livres mudam a cada minuto: nunca ficam em memória
export const availableSlots = (serviceId, day) =>
  run(supabase.rpc('available_slots', { p_service_id: serviceId, p_day: day }))

/* ---------------- Clientes ---------------- */

export const listCustomers = () =>
  cached('customers', () =>
    run(
      supabase
        .from('customers')
        .select('*, appointments(count)')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .order('name'),
    ),
  )

export function saveCustomer(customer) {
  const { id, appointments, ...fields } = customer
  return id
    ? write(supabase.from('customers').update(fields).eq('id', id).select().single())
    : write(supabase.from('customers').insert(fields).select().single())
}

export const getCustomerByPhone = (phone) =>
  run(supabase.from('customers').select('*').eq('phone', phone).maybeSingle())

export const deleteCustomer = (id) => write(supabase.from('customers').delete().eq('id', id))

/* ---------------- Agendamentos ---------------- */

const APPT_FIELDS =
  '*, customer:customers(id, name, phone), service:services(id, name, duration_min, price)'

export const listAppointments = (fromIso, toIso) =>
  cached(`appts:${fromIso}:${toIso}`, () =>
    run(
      supabase
        .from('appointments')
        .select(APPT_FIELDS)
        .gte('starts_at', fromIso)
        .lt('starts_at', toIso)
        .order('starts_at'),
    ),
  )

export const createAppointment = (appt) =>
  write(supabase.from('appointments').insert({ source: 'painel', ...appt }).select(APPT_FIELDS).single())

export function setAppointmentStatus(id, status) {
  const patch = { status }
  if (status === 'confirmado') patch.confirmed_at = new Date().toISOString()
  if (status === 'marcado') patch.confirmed_at = null
  return write(supabase.from('appointments').update(patch).eq('id', id))
}

/* ---------------- Conversas ---------------- */

export const listConversations = () =>
  cached('convs', () =>
    run(
      supabase
        .from('customers')
        .select('id, name, phone, channel, bot_paused, needs_human, last_message_at, messages(body, sender, created_at)')
        .not('last_message_at', 'is', null)
        .order('last_message_at', { ascending: false })
        .order('created_at', { referencedTable: 'messages', ascending: false })
        .limit(1, { referencedTable: 'messages' }),
    ),
  )

export const listMessages = (customerId) =>
  cached(`msgs:${customerId}`, () =>
    run(supabase.from('messages').select('*').eq('customer_id', customerId).order('created_at')),
  )

/** Pede à Edge Function que envie pelo WhatsApp as mensagens indicadas */
async function deliver(messageIds) {
  if (!messageIds.length) return { ok: true }
  const { data, error } = await supabase.functions.invoke('whatsapp-send', { body: { message_ids: messageIds } })
  cache.clear()
  if (error) return { ok: false, error: 'A mensagem ficou guardada, mas não foi enviada pelo WhatsApp (função ainda não configurada).' }
  const failed = (data?.results || []).find((r) => !r.ok)
  return failed ? { ok: false, error: failed.error } : { ok: true }
}

/** Resposta da recepção. Nas conversas reais do WhatsApp, também é enviada. */
export async function sendHumanMessage(customer, body) {
  const whatsapp = customer.channel === 'whatsapp'
  const row = await write(
    supabase
      .from('messages')
      .insert({
        customer_id: customer.id,
        sender: 'humano',
        body,
        channel: customer.channel || 'simulador',
        status: whatsapp ? 'pendente' : 'simulada',
      })
      .select('id')
      .single(),
  )
  return whatsapp ? deliver([row.id]) : { ok: true }
}

/** Simulador: uma "cliente" escreve, e a mensagem segue o mesmo caminho do WhatsApp */
export const simulateIncoming = (phone, name, body) =>
  write(supabase.rpc('handle_incoming', { p_phone: phone, p_name: name, p_body: body, p_channel: 'simulador' }))

/** Lembretes da véspera para um dia ("AAAA-MM-DD"). Devolve quantos foram criados. */
export async function sendReminders(day) {
  const rows = await write(supabase.rpc('send_reminders', { p_day: day }))
  const real = (rows || []).filter((r) => r.channel === 'whatsapp').map((r) => r.message_id)
  const result = await deliver(real)
  return { count: (rows || []).length, ...result }
}

/** Pausar o bot = a recepção assume a conversa */
export const setBotPaused = (customerId, paused) =>
  write(
    supabase
      .from('customers')
      .update(paused ? { bot_paused: true } : { bot_paused: false, needs_human: false })
      .eq('id', customerId),
  )

export const countWaitingHuman = () =>
  cached('waiting', async () => {
    const { count, error } = await supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('needs_human', true)
    if (error) throw error
    return count || 0
  })

/** Avisa quando entra uma mensagem nova ou muda um cliente (tempo real) */
export function subscribeToChanges(onChange) {
  const handle = (payload) => {
    cache.clear()
    onChange(payload)
  }
  const channel = supabase
    .channel(`painel-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, handle)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, handle)
    .subscribe()
  return () => supabase.removeChannel(channel)
}

/* ---------------- Pré-carregamento ----------------
   Logo depois do login, busca em paralelo os dados de todas as páginas.
   Quando abrires uma página, os dados já estão à espera. */
export function prefetchAll() {
  const today = todayKey()
  const monday = addDays(today, -((weekdayOf(today) + 6) % 7))
  const ignore = () => {}
  listAppointments(...dayRange(today, addDays(today, 6))).catch(ignore)
  listAppointments(...dayRange(monday, addDays(monday, 6))).catch(ignore)
  listConversations().catch(ignore)
  listCustomers().catch(ignore)
  listServices().catch(ignore)
  listHours().catch(ignore)
  listBlocked().catch(ignore)
  getSettings().catch(ignore)
}
