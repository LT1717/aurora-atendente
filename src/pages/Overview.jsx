import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listAppointments, listConversations, resetDemo } from '../lib/api'
import {
  STATUS, addDays, dayKey, dayRange, fmtLongDate, fmtRelativeDay, fmtTime, fmtWhen,
  friendlyError, money, todayKey,
} from '../lib/format'
import { Avatar, Badge, Empty, ErrorBox, Loading, useToast } from '../components/ui'
import Icon from '../components/Icon'
import { t } from '../lib/i18n'

const ACTIVE = ['marcado', 'confirmado']

export default function Overview() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [resetting, setResetting] = useState(false)

  const load = useCallback(async () => {
    try {
      const today = todayKey()
      const [from, to] = dayRange(today, addDays(today, 6))
      const [appts, convs] = await Promise.all([listAppointments(from, to), listConversations()])
      setData({ today, appts, convs })
      setError('')
    } catch (err) {
      setError(friendlyError(err))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function onReset() {
    if (!confirm(t('Repor os dados de demonstração? Tudo o que foi alterado será substituído pelos dados de exemplo.'))) return
    setResetting(true)
    try {
      await resetDemo()
      await load()
      toast(t('Dados de demonstração repostos.'))
    } catch (err) {
      toast(friendlyError(err), 'danger')
    } finally {
      setResetting(false)
    }
  }

  if (error) return <div className="page"><ErrorBox>{error}</ErrorBox></div>
  if (!data) return <Loading />

  const { today, appts, convs } = data
  const todays = appts.filter((a) => dayKey(a.starts_at) === today && a.status !== 'cancelado')
  const futureDays = [...new Set(appts.map((a) => dayKey(a.starts_at)).filter((k) => k > today))].sort()
  const nextDay = futureDays[0]
  const nextDayAppts = appts.filter((a) => dayKey(a.starts_at) === nextDay && ACTIVE.includes(a.status))
  const toConfirm = nextDayAppts.filter((a) => a.status === 'marcado')
  const week = appts.filter((a) => ACTIVE.includes(a.status) || a.status === 'concluido')
  const weekRevenue = week.reduce((sum, a) => sum + Number(a.service?.price || 0), 0)
  const viaWhatsapp = week.filter((a) => a.source === 'whatsapp').length
  const waiting = convs.filter((c) => c.needs_human)

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-date">{fmtLongDate(today)}</p>
          <h1>{t('Visão geral')}</h1>
        </div>
        <button className="btn btn-ghost" onClick={onReset} disabled={resetting} title={t('Volta a pôr os dados de exemplo')}>
          <Icon name="refresh" />
          {resetting ? t('Repondo…') : t('Repor dados de demonstração')}
        </button>
      </header>

      <section className="stats">
        <Stat label={t('Atendimentos hoje')} value={todays.length}
          note={t('{n} confirmados', { n: todays.filter((a) => a.status === 'confirmado').length })} />
        <Stat label={`${t('A confirmar')} · ${nextDay ? fmtRelativeDay(nextDay).toLowerCase() : t('próximo dia')}`}
          value={toConfirm.length} tone={toConfirm.length ? 'warn' : undefined}
          note={t('de {n} agendados', { n: nextDayAppts.length })} />
        <Stat label={t('Aguardando a recepção')} value={waiting.length} tone={waiting.length ? 'danger' : undefined}
          note={waiting.length ? t('a assistente está pausada nessas conversas') : t('nenhuma conversa parada')} />
        <Stat label={t('Previsto em 7 dias')} value={money(weekRevenue)}
          note={t('{a} de {b} agendados pelo WhatsApp', { a: viaWhatsapp, b: week.length })} />
      </section>

      <div className="overview-grid">
        <section className="panel">
          <header className="panel-head">
            <h2>{t('Hoje')}</h2>
            <Link to="/agenda" className="link">{t('Abrir agenda')}</Link>
          </header>
          {todays.length === 0 ? (
            <Empty icon="calendar" title={t('Nenhum atendimento hoje')}>{t('A clínica pode estar fechada ou a agenda está livre.')}</Empty>
          ) : (
            <ol className="timeline">
              {todays.map((a) => (
                <li key={a.id} className={`timeline-item ${new Date(a.ends_at) < new Date() ? 'is-past' : ''}`}>
                  <time>{fmtTime(a.starts_at)}</time>
                  <div className="timeline-body">
                    <strong>{a.customer?.name}</strong>
                    <span>{a.service?.name}</span>
                  </div>
                  <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2>{t('Precisa de atenção')}</h2>
          </header>
          {waiting.length === 0 && toConfirm.length === 0 ? (
            <Empty icon="check" title={t('Tudo em dia')}>{t('Nenhuma conversa à espera e todos confirmaram.')}</Empty>
          ) : (
            <ul className="attention">
              {waiting.map((c) => (
                <li key={c.id}>
                  <Link to={`/conversas?c=${c.id}`} className="attention-row">
                    <Avatar name={c.name} />
                    <div>
                      <strong>{c.name}</strong>
                      <span className="clip">{c.messages?.[0]?.body}</span>
                    </div>
                    <Badge tone="danger">{t('Quer falar com a recepção')}</Badge>
                    <span className="muted small">{fmtWhen(c.last_message_at)}</span>
                  </Link>
                </li>
              ))}
              {toConfirm.map((a) => (
                <li key={a.id}>
                  <Link to={`/agenda?d=${nextDay}`} className="attention-row">
                    <Avatar name={a.customer?.name} />
                    <div>
                      <strong>{a.customer?.name}</strong>
                      <span>
                        {a.service?.name} · {fmtRelativeDay(nextDay).toLowerCase()} {t('às')} {fmtTime(a.starts_at)}
                      </span>
                    </div>
                    <Badge tone="warn">{a.reminder_sent_at ? t('Sem resposta ao lembrete') : t('Lembrete pendente')}</Badge>
                    <span className="muted small">{fmtTime(a.starts_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value, note, tone }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  )
}
