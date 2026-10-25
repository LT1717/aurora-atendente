// Tudo é mostrado na hora de São Paulo, seja onde for que o painel é aberto.
export const TZ = 'America/Sao_Paulo'
// O Brasil não tem horário de verão desde 2019: São Paulo está sempre a -03:00.
const OFFSET = '-03:00'

const timeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const shortDateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: 'numeric', month: 'short' })
const longDateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
const weekdayShortFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short' })
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const moneyFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** "AAAA-MM-DD" do dia (em São Paulo) de uma data/hora */
export const dayKey = (value = new Date()) => dayKeyFmt.format(new Date(value))
export const todayKey = () => dayKey(new Date())

/** Soma dias a um "AAAA-MM-DD" */
export function addDays(key, n) {
  const d = new Date(`${key}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Início e fim de um dia de São Paulo, em ISO, para filtrar na base de dados */
export function dayRange(fromKey, toKey = fromKey) {
  return [
    new Date(`${fromKey}T00:00:00${OFFSET}`).toISOString(),
    new Date(`${addDays(toKey, 1)}T00:00:00${OFFSET}`).toISOString(),
  ]
}

/** 0 = domingo ... 6 = sábado */
export const weekdayOf = (key) => new Date(`${key}T12:00:00Z`).getUTCDay()

export const fmtTime = (ts) => timeFmt.format(new Date(ts))
export const fmtDateTime = (ts) => dateTimeFmt.format(new Date(ts)).replace(',', ' ·')
export const fmtShortDate = (key) => shortDateFmt.format(new Date(`${key}T12:00:00Z`)).replace('.', '')
export const fmtWeekdayShort = (key) =>
  weekdayShortFmt.format(new Date(`${key}T12:00:00Z`)).replace('.', '')
export function fmtLongDate(key) {
  const s = longDateFmt.format(new Date(`${key}T12:00:00Z`))
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function fmtRelativeDay(key) {
  const today = todayKey()
  if (key === today) return 'Hoje'
  if (key === addDays(today, 1)) return 'Amanhã'
  if (key === addDays(today, -1)) return 'Ontem'
  return fmtLongDate(key)
}

/** Hora curta para listas de conversas: "14:05", "ontem", "12/10" */
export function fmtWhen(ts) {
  if (!ts) return ''
  const key = dayKey(ts)
  const today = todayKey()
  if (key === today) return fmtTime(ts)
  if (key === addDays(today, -1)) return 'ontem'
  return `${key.slice(8, 10)}/${key.slice(5, 7)}`
}

export const money = (v) => moneyFmt.format(Number(v || 0))

/** "5511987650101" -> "+55 (11) 98765-0101" */
export function fmtPhone(raw = '') {
  const d = String(raw).replace(/\D/g, '')
  if (d.length === 13 && d.startsWith('55')) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`
  if (d.length === 12 && d.startsWith('55')) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`
  return d ? `+${d}` : ''
}

/** Guarda o telefone só com dígitos e com o 55 do Brasil */
export function normalizePhone(raw = '') {
  let d = String(raw).replace(/\D/g, '')
  if (d.length === 10 || d.length === 11) d = `55${d}`
  return d
}

export const initials = (name = '?') =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('') || '?'

export const firstName = (name = '') => name.split(' ')[0] || ''

export const STATUS = {
  marcado: { label: 'A confirmar', tone: 'warn' },
  confirmado: { label: 'Confirmado', tone: 'ok' },
  concluido: { label: 'Concluído', tone: 'muted' },
  cancelado: { label: 'Cancelado', tone: 'danger' },
  faltou: { label: 'Faltou', tone: 'danger' },
}

export const STAGES = {
  novo: { label: 'Novo contato', tone: 'info' },
  orcamento: { label: 'Orçamento', tone: 'warn' },
  fechado: { label: 'Cliente', tone: 'ok' },
  perdido: { label: 'Perdido', tone: 'muted' },
}

export const WEEKDAYS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']

/** Converte erros técnicos em frases que a recepção percebe */
export function friendlyError(error) {
  if (!error) return ''
  const msg = error.message || String(error)
  if (error.code === '23P01' || msg.includes('appointments_sem_sobreposicao'))
    return 'Esse horário já está ocupado por outro agendamento. Escolha outro.'
  if (error.code === '23505' && msg.includes('phone')) return 'Já existe um cliente com esse telefone.'
  if (error.code === '23505') return 'Esse registro já existe.'
  if (error.code === '23503') return 'Não é possível excluir: há agendamentos ligados a este registro. Desative-o em vez de excluir.'
  if (msg.includes('Invalid login credentials')) return 'E-mail ou senha incorretos.'
  if (msg.includes('Failed to fetch')) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.'
  return msg
}
