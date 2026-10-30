import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { listAppointments, listBlocked, listHours, sendReminders, setAppointmentStatus } from '../lib/api'
import {
  STATUS, weekdayName, addDays, dayKey, dayRange, fmtDateTime, fmtPhone, fmtRelativeDay, fmtShortDate,
  fmtTime, fmtWeekdayShort, friendlyError, money, todayKey, weekdayOf,
} from '../lib/format'
import { Badge, Empty, ErrorBox, Loading, useToast } from '../components/ui'
import Icon from '../components/Icon'
import AppointmentForm from './AppointmentForm'
import { t } from '../lib/i18n'

/** Segunda-feira da semana de um dia */
const mondayOf = (key) => addDays(key, -((weekdayOf(key) + 6) % 7))

export default function Agenda() {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const day = params.get('d') || todayKey()
  const weekStart = mondayOf(day)
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  const [appts, setAppts] = useState(null)
  const [hours, setHours] = useState([])
  const [blocked, setBlocked] = useState([])
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [reminding, setReminding] = useState(false)

  const load = useCallback(async () => {
    try {
      const [from, to] = dayRange(weekStart, addDays(weekStart, 6))
      const [a, h, b] = await Promise.all([listAppointments(from, to), listHours(), listBlocked()])
      setAppts(a)
      setHours(h)
      setBlocked(b)
      setError('')
    } catch (err) {
      setError(friendlyError(err))
    }
  }, [weekStart])

  useEffect(() => {
    load()
  }, [load])

  const goTo = (key) => setParams({ d: key })

  async function changeStatus(appt, status) {
    try {
      await setAppointmentStatus(appt.id, status)
      toast(t('Agendamento marcado como “{s}”.', { s: STATUS[status].label.toLowerCase() }))
      load()
    } catch (err) {
      toast(friendlyError(err), 'danger')
    }
  }

  async function remind() {
    setReminding(true)
    try {
      const r = await sendReminders(day)
      if (!r.ok) toast(r.error, 'danger')
      else toast(r.count ? t('{n} lembrete(s) enviado(s). Veja em Conversas.', { n: r.count }) : t('Todos já tinham recebido o lembrete.'))
      load()
    } catch (err) {
      toast(friendlyError(err), 'danger')
    } finally {
      setReminding(false)
    }
  }

  const dayAppts = (appts || []).filter((a) => dayKey(a.starts_at) === day)
  const pendingReminders = dayAppts.filter((a) => a.status === 'marcado' && !a.reminder_sent_at).length
  const hoursOfDay = hours.find((h) => h.weekday === weekdayOf(day))
  const blockedDay = blocked.find((b) => b.day === day)
  const closed = blockedDay || (hoursOfDay && !hoursOfDay.is_open)

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-date">{fmtRelativeDay(day)}</p>
          <h1>{t('Agenda')}</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Icon name="plus" /> {t('Novo agendamento')}
        </button>
      </header>

      <div className="week-nav">
        <button className="icon-btn" onClick={() => goTo(addDays(day, -7))} aria-label={t('Semana anterior')}>
          <Icon name="left" />
        </button>
        <div className="week-strip" role="tablist" aria-label={t('Dias da semana')}>
          {days.map((k) => {
            const count = (appts || []).filter((a) => dayKey(a.starts_at) === k && a.status !== 'cancelado').length
            return (
              <button
                key={k}
                role="tab"
                aria-selected={k === day}
                className={`week-day ${k === day ? 'is-active' : ''} ${k === todayKey() ? 'is-today' : ''}`}
                onClick={() => goTo(k)}
              >
                <span className="week-day-name">{fmtWeekdayShort(k)}</span>
                <span className="week-day-num">{k.slice(8, 10)}</span>
                <span className="week-day-count">{count ? t('{n} agend.', { n: count }) : '—'}</span>
              </button>
            )
          })}
        </div>
        <button className="icon-btn" onClick={() => goTo(addDays(day, 7))} aria-label={t('Próxima semana')}>
          <Icon name="right" />
        </button>
        {day !== todayKey() && (
          <button className="btn btn-ghost btn-sm" onClick={() => goTo(todayKey())}>{t('Hoje')}</button>
        )}
      </div>

      <ErrorBox>{error}</ErrorBox>

      <section className="panel">
        <header className="panel-head">
          <h2>
            {weekdayName(weekdayOf(day))}, {fmtShortDate(day)}
          </h2>
          {day > todayKey() && pendingReminders > 0 && (
            <button className="btn btn-soft btn-sm" onClick={remind} disabled={reminding}>
              <Icon name="bell" /> {reminding ? t('Enviando…') : t('Enviar lembretes ({n})', { n: pendingReminders })}
            </button>
          )}
          {hoursOfDay && !closed && (
            <span className="muted small">
              {t('Aberto')} {hoursOfDay.open_time.slice(0, 5)}–{hoursOfDay.close_time.slice(0, 5)}
              {hoursOfDay.break_start && ` · ${t('intervalo')} ${hoursOfDay.break_start.slice(0, 5)}–${hoursOfDay.break_end.slice(0, 5)}`}
            </span>
          )}
        </header>

        {!appts ? (
          <Loading />
        ) : closed ? (
          <Empty icon="clock" title={blockedDay ? `${t('Fechado')}: ${blockedDay.reason || t('dia bloqueado')}` : t('A clínica não abre neste dia')}>
            {dayAppts.length > 0 && t('Atenção: há {n} agendamento(s) neste dia.', { n: dayAppts.length })}
          </Empty>
        ) : dayAppts.length === 0 ? (
          <Empty icon="calendar" title={t('Agenda livre neste dia')}>
            <button className="btn btn-soft btn-sm" onClick={() => setCreating(true)}>
              <Icon name="plus" /> {t('Novo agendamento')}
            </button>
          </Empty>
        ) : (
          <ol className="appt-list">
            {dayAppts.map((a) => (
              <li key={a.id} className={`appt appt-${a.status}`}>
                <div className="appt-time">
                  <strong>{fmtTime(a.starts_at)}</strong>
                  <span>{fmtTime(a.ends_at)}</span>
                </div>
                <div className="appt-main">
                  <div className="appt-title">
                    <strong>{a.customer?.name}</strong>
                    <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
                  </div>
                  <div className="appt-meta">
                    <span>{a.service?.name} · {money(a.service?.price)}</span>
                    <span><Icon name="phone" size={14} /> {fmtPhone(a.customer?.phone)}</span>
                    <span title={a.source === 'painel' ? t('Criado no painel') : t('Agendado pela assistente')}>
                      <Icon name={a.source === 'painel' ? 'monitor' : 'whatsapp'} size={14} />
                      {a.source === 'painel' ? t('Painel') : a.source === 'simulador' ? t('Simulador') : 'WhatsApp'}
                    </span>
                  </div>
                  <ReminderLine appt={a} />
                </div>
                <div className="appt-actions">
                  <label className="sr-only" htmlFor={`st-${a.id}`}>{t('Alterar estado')}</label>
                  <select id={`st-${a.id}`} value={a.status} onChange={(e) => changeStatus(a, e.target.value)}>
                    {Object.entries(STATUS).map(([value, s]) => (
                      <option key={value} value={value}>{s.label}</option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {creating && (
        <AppointmentForm
          initialDay={day < todayKey() ? todayKey() : day}
          onClose={() => setCreating(false)}
          onSaved={(appt) => {
            setCreating(false)
            toast(t('Agendamento criado.'))
            const k = dayKey(appt.starts_at)
            if (k === day) load()
            else goTo(k)
          }}
        />
      )}
    </div>
  )
}

function ReminderLine({ appt }) {
  if (['cancelado', 'faltou'].includes(appt.status)) return null
  const parts = []
  if (appt.reminder_sent_at) parts.push(`${t('Lembrete enviado')} ${fmtDateTime(appt.reminder_sent_at)}`)
  if (appt.confirmed_at) parts.push(`${t('confirmou')} ${fmtDateTime(appt.confirmed_at)}`)
  if (!parts.length) return null
  return (
    <p className="appt-reminder">
      <Icon name="bell" size={14} /> {parts.join(' · ')}
    </p>
  )
}
