import { useCallback, useEffect, useState } from 'react'
import { addBlocked, getSettings, listBlocked, listHours, removeBlocked, saveHours, saveSettings } from '../lib/api'
import { weekdayName, fmtLongDate, friendlyError, todayKey } from '../lib/format'
import { Empty, ErrorBox, Field, Loading, Switch, useToast } from '../components/ui'
import Icon from '../components/Icon'
import { getLang, t } from '../lib/i18n'

// Segunda primeiro, domingo no fim
const ORDER = [1, 2, 3, 4, 5, 6, 0]
const t5 = (t) => (t ? t.slice(0, 5) : '')

export default function Hours() {
  const toast = useToast()
  const [hours, setHours] = useState(null)
  const [step, setStep] = useState(30)
  const [blocked, setBlocked] = useState([])
  const [newDay, setNewDay] = useState('')
  const [newReason, setNewReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [h, b, s] = await Promise.all([listHours(), listBlocked(), getSettings()])
      const byDay = Object.fromEntries(h.map((r) => [r.weekday, r]))
      setHours(
        ORDER.map((wd) => {
          const r = byDay[wd] || { weekday: wd, is_open: false, open_time: '09:00', close_time: '18:00' }
          return { ...r, open_time: t5(r.open_time), close_time: t5(r.close_time), break_start: t5(r.break_start), break_end: t5(r.break_end) }
        }),
      )
      setBlocked(b)
      setStep(s?.slot_interval_min ?? 30)
      setError('')
    } catch (err) {
      setError(friendlyError(err))
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const update = (wd, patch) => setHours((rows) => rows.map((r) => (r.weekday === wd ? { ...r, ...patch } : r)))

  async function save() {
    // validações simples antes de gravar
    for (const r of hours) {
      if (!r.is_open) continue
      if (r.close_time <= r.open_time) return setError(`${weekdayName(r.weekday)}: ${t('o fechamento precisa ser depois da abertura.')}`)
      if (!!r.break_start !== !!r.break_end) return setError(`${weekdayName(r.weekday)}: ${t('preencha o início e o fim do intervalo, ou deixe os dois vazios.')}`)
      if (r.break_start && r.break_end <= r.break_start) return setError(`${weekdayName(r.weekday)}: ${t('o intervalo termina antes de começar.')}`)
    }
    setBusy(true)
    setError('')
    try {
      await saveHours(
        hours.map((r) => ({
          weekday: r.weekday,
          is_open: r.is_open,
          open_time: r.open_time,
          close_time: r.close_time,
          break_start: r.break_start || null,
          break_end: r.break_end || null,
        })),
      )
      await saveSettings({ slot_interval_min: Number(step) })
      toast(t('Horários salvos.'))
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  async function addDay(e) {
    e.preventDefault()
    if (!newDay) return
    try {
      await addBlocked(newDay, newReason.trim() || null)
      setNewDay('')
      setNewReason('')
      toast(t('Dia bloqueado.'))
      load()
    } catch (err) {
      toast(friendlyError(err), 'danger')
    }
  }

  async function unblock(b) {
    try {
      await removeBlocked(b.id)
      toast(t('Dia desbloqueado.'))
      load()
    } catch (err) {
      toast(friendlyError(err), 'danger')
    }
  }

  if (!hours) return error ? <div className="page"><ErrorBox>{error}</ErrorBox></div> : <Loading />

  const upcoming = blocked.filter((b) => b.day >= todayKey())

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-date">{t('A assistente só oferece horários dentro destes períodos')}</p>
          <h1>{t('Horários')}</h1>
        </div>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          <Icon name="check" /> {busy ? t('Salvando…') : t('Salvar horários')}
        </button>
      </header>

      <ErrorBox>{error}</ErrorBox>

      <section className="panel">
        <header className="panel-head"><h2>{t('Funcionamento semanal')}</h2></header>
        <div className="hours">
          {hours.map((r) => {
            const day = weekdayName(r.weekday)
            return (
              <div key={r.weekday} className={`hours-row ${r.is_open ? '' : 'is-off'}`}>
                <div className="hours-day">
                  <Switch checked={r.is_open} onChange={(v) => update(r.weekday, { is_open: v })} label={`${day}: ${t('aberto')}`} />
                  <span>{day}</span>
                </div>
                {r.is_open ? (
                  <div className="hours-times">
                    <div className="time-pair">
                      <span className="time-label">{t('Atende')}</span>
                      <TimeSelect value={r.open_time} onChange={(v) => update(r.weekday, { open_time: v })} label={`${day}: ${t('abre às')}`} />
                      <span className="time-sep">{getLang() === 'en' ? 'to' : 'às'}</span>
                      <TimeSelect value={r.close_time} onChange={(v) => update(r.weekday, { close_time: v })} label={`${day}: ${t('fecha às')}`} />
                    </div>
                    <div className="time-pair">
                      <span className="time-label">{t('Intervalo')}</span>
                      <TimeSelect value={r.break_start} onChange={(v) => update(r.weekday, { break_start: v })} label={`${day}: ${t('início do intervalo')}`} optional />
                      <span className="time-sep">{getLang() === 'en' ? 'to' : 'às'}</span>
                      <TimeSelect value={r.break_end} onChange={(v) => update(r.weekday, { break_end: v })} label={`${day}: ${t('fim do intervalo')}`} optional />
                      {(r.break_start || r.break_end) && (
                        <button type="button" className="icon-btn" onClick={() => update(r.weekday, { break_start: '', break_end: '' })} aria-label={`${day}: ${t('Sem intervalo')}`} title={t('Sem intervalo')}>
                          <Icon name="x" size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <span className="muted">{t('Fechado')}</span>
                )}
              </div>
            )
          })}
        </div>
        <div className="hours-step">
          <Field label={t('Intervalo entre horários oferecidos')} hint={t('Ex.: 30 min oferece 9:00, 9:30, 10:00…')}>
            <select value={step} onChange={(e) => setStep(e.target.value)}>
              {[15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{t('{n} minutos', { n: m })}</option>)}
            </select>
          </Field>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head"><h2>{t('Feriados e folgas')}</h2></header>
        <form className="inline-form" onSubmit={addDay}>
          <Field label={t('Dia')}>
            <input type="date" value={newDay} min={todayKey()} onChange={(e) => setNewDay(e.target.value)} required />
          </Field>
          <Field label={t('Motivo (opcional)')}>
            <input value={newReason} onChange={(e) => setNewReason(e.target.value)} placeholder={t('Ex.: Feriado municipal')} />
          </Field>
          <button className="btn btn-soft"><Icon name="plus" /> {t('Bloquear dia')}</button>
        </form>
        {upcoming.length === 0 ? (
          <Empty icon="calendar" title={t('Nenhum dia bloqueado')} />
        ) : (
          <ul className="blocked-list">
            {upcoming.map((b) => (
              <li key={b.id}>
                <div>
                  <strong>{fmtLongDate(b.day)}</strong>
                  {b.reason && <span className="muted"> · {b.reason}</span>}
                </div>
                <button className="icon-btn" onClick={() => unblock(b)} aria-label={`${t('Desbloquear')} ${b.day}`}>
                  <Icon name="trash" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// Lista de horas de 15 em 15 minutos, sempre no formato 24h (09:00, 13:30…)
const TIMES = Array.from({ length: (23 - 6) * 4 + 1 }, (_, i) => {
  const m = 6 * 60 + i * 15
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
})

function TimeSelect({ value, onChange, label, optional = false }) {
  const options = value && !TIMES.includes(value) ? [...TIMES, value].sort() : TIMES
  return (
    <select className="time-select" value={value || ''} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {optional && <option value="">—</option>}
      {options.map((t) => (
        <option key={t} value={t}>{t}</option>
      ))}
    </select>
  )
}
