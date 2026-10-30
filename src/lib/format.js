import { locale, t } from './i18n'

// Tudo é mostrado na hora de São Paulo, seja onde for que o painel é aberto.
export const TZ = 'America/Sao_Paulo'
// O Brasil não tem horário de verão desde 2019: São Paulo está sempre a -03:00.
const OFFSET = '-03:00'

const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })

// Formatadores na língua escolhida (criados uma vez por língua)
const fmtCache = {}
function F() {
  const loc = locale()
  if (!fmtCache[loc]) {
    fmtCache[loc] = {
      time: new Intl.DateTimeFormat(loc, { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
      shortDate: new Intl.DateTimeFormat(loc, { timeZone: 'UTC', day: 'numeric', month: 'short' }),
      longDate: new Intl.DateTimeFormat(loc, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }),
      weekdayShort: new Intl.DateTimeFormat(loc, { timeZone: 'UTC', weekday: 'short' }),
      dateTime: new Intl.DateTimeFormat(loc, { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
      // a clínica é no Brasil: os preços são sempre em reais
      money: new Intl.NumberFormat(loc, { style: 'currency', currency: 'BRL' }),
    }
  }
  return fmtCache[loc]
}

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

export const fmtTime = (ts) => F().time.format(new Date(ts))
export const fmtDateTime = (ts) => F().dateTime.format(new Date(ts)).replace(',', ' ·')
export const fmtShortDate = (key) => F().shortDate.format(new Date(`${key}T12:00:00Z`)).replace('.', '')
export const fmtWeekdayShort = (key) => F().weekdayShort.format(new Date(`${key}T12:00:00Z`)).replace('.', '')
export function fmtLongDate(key) {
  const s = F().longDate.format(new Date(`${key}T12:00:00Z`))
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function fmtRelativeDay(key) {
  const today = todayKey()
  if (key === today) return t('Hoje')
  if (key === addDays(today, 1)) return t('Amanhã')
  if (key === addDays(today, -1)) return t('Ontem')
  return fmtLongDate(key)
}

/** Hora curta para listas de conversas: "14:05", "ontem", "12/10" */
export function fmtWhen(ts) {
  if (!ts) return ''
  const key = dayKey(ts)
  const today = todayKey()
  if (key === today) return fmtTime(ts)
  if (key === addDays(today, -1)) return t('ontem')
  return locale() === 'en-US' ? `${key.slice(5, 7)}/${key.slice(8, 10)}` : `${key.slice(8, 10)}/${key.slice(5, 7)}`
}

export const money = (v) => F().money.format(Number(v || 0))

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

// As etiquetas são traduzidas no momento em que são lidas
const labelled = (map) =>
  Object.fromEntries(
    Object.entries(map).map(([k, [label, tone]]) => [k, { tone, get label() { return t(label) } }]),
  )

export const STATUS = labelled({
  marcado: ['A confirmar', 'warn'],
  confirmado: ['Confirmado', 'ok'],
  concluido: ['Concluído', 'muted'],
  cancelado: ['Cancelado', 'danger'],
  faltou: ['Faltou', 'danger'],
})

export const STAGES = labelled({
  novo: ['Novo contato', 'info'],
  orcamento: ['Orçamento', 'warn'],
  fechado: ['Cliente', 'ok'],
  perdido: ['Perdido', 'muted'],
})

const WEEKDAYS_PT = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']
/** Nome do dia da semana (0 = domingo) na língua escolhida */
export const weekdayName = (i) => t(WEEKDAYS_PT[i])

/** Converte erros técnicos em frases que a recepção percebe */
export function friendlyError(error) {
  if (!error) return ''
  const msg = error.message || String(error)
  if (error.code === '23P01' || msg.includes('appointments_sem_sobreposicao'))
    return t('Esse horário já está ocupado por outro agendamento. Escolha outro.')
  if (error.code === '23505' && msg.includes('phone')) return t('Já existe um cliente com esse telefone.')
  if (error.code === '23505') return t('Esse registro já existe.')
  if (error.code === '23503')
    return t('Não é possível excluir: há agendamentos ligados a este registro. Desative-o em vez de excluir.')
  if (msg.includes('Invalid login credentials')) return t('E-mail ou senha incorretos.')
  if (msg.includes('Failed to fetch')) return t('Sem conexão com o servidor. Verifique a internet e tente de novo.')
  return msg
}
