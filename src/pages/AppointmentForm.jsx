import { useEffect, useMemo, useState } from 'react'
import { availableSlots, createAppointment, listCustomers, listServices, saveCustomer } from '../lib/api'
import { fmtPhone, fmtTime, friendlyError, money, normalizePhone, todayKey } from '../lib/format'
import { ErrorBox, Field, Loading, Modal } from '../components/ui'

export default function AppointmentForm({ initialDay, onClose, onSaved }) {
  const [customers, setCustomers] = useState(null)
  const [services, setServices] = useState([])
  const [mode, setMode] = useState('existing') // existing | new
  const [query, setQuery] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [day, setDay] = useState(initialDay)
  const [slots, setSlots] = useState(null)
  const [slot, setSlot] = useState(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([listCustomers(), listServices()])
      .then(([c, s]) => {
        setCustomers(c)
        setServices(s.filter((x) => x.active))
      })
      .catch((err) => setError(friendlyError(err)))
  }, [])

  // Sempre que muda o serviço ou o dia, vai buscar os horários livres
  useEffect(() => {
    setSlot(null)
    if (!serviceId || !day) return setSlots(null)
    let cancelled = false
    setSlots('loading')
    availableSlots(serviceId, day)
      .then((rows) => !cancelled && setSlots(rows))
      .catch((err) => !cancelled && (setError(friendlyError(err)), setSlots([])))
    return () => {
      cancelled = true
    }
  }, [serviceId, day])

  const filtered = useMemo(() => {
    if (!customers) return []
    const q = query.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    return customers
      .filter((c) => !q || c.name?.toLowerCase().includes(q) || (digits && c.phone.includes(digits)))
      .slice(0, 8)
  }, [customers, query])

  const service = services.find((s) => s.id === serviceId)

  async function save(e) {
    e.preventDefault()
    setError('')
    if (mode === 'existing' && !customerId) return setError('Escolha um cliente.')
    if (mode === 'new' && (!newName.trim() || normalizePhone(newPhone).length < 12))
      return setError('Preencha o nome e um telefone com DDD.')
    if (!slot) return setError('Escolha um horário livre.')

    setBusy(true)
    try {
      let cid = customerId
      if (mode === 'new') {
        const created = await saveCustomer({ name: newName.trim(), phone: normalizePhone(newPhone) })
        cid = created.id
      }
      const appt = await createAppointment({
        customer_id: cid,
        service_id: serviceId,
        starts_at: slot.slot_start,
        ends_at: slot.slot_end,
        status: 'marcado',
        notes: notes.trim() || null,
      })
      onSaved(appt)
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
      // o horário pode ter sido ocupado entretanto: atualizar a lista
      if (serviceId && day) availableSlots(serviceId, day).then(setSlots).catch(() => {})
    }
  }

  return (
    <Modal
      title="Novo agendamento"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} type="button">Cancelar</button>
          <button className="btn btn-primary" form="appt-form" disabled={busy}>
            {busy ? 'Salvando…' : 'Agendar'}
          </button>
        </>
      }
    >
      {!customers ? (
        <Loading />
      ) : (
        <form id="appt-form" className="form-grid" onSubmit={save}>
          <fieldset className="span-2">
            <legend className="field-label">Cliente</legend>
            <div className="segmented" role="tablist">
              <button type="button" className={mode === 'existing' ? 'is-active' : ''} onClick={() => setMode('existing')}>
                Já é cliente
              </button>
              <button type="button" className={mode === 'new' ? 'is-active' : ''} onClick={() => setMode('new')}>
                Cliente novo
              </button>
            </div>

            {mode === 'existing' ? (
              <div className="picker">
                <input
                  type="search"
                  placeholder="Buscar por nome ou telefone"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Buscar cliente"
                />
                <ul className="picker-list" role="listbox" aria-label="Clientes">
                  {filtered.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={c.id === customerId}
                        className={c.id === customerId ? 'is-active' : ''}
                        onClick={() => setCustomerId(c.id)}
                      >
                        <strong>{c.name || 'Sem nome'}</strong>
                        <span>{fmtPhone(c.phone)}</span>
                      </button>
                    </li>
                  ))}
                  {filtered.length === 0 && <li className="muted small picker-empty">Nenhum cliente encontrado.</li>}
                </ul>
              </div>
            ) : (
              <div className="form-grid">
                <Field label="Nome">
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome completo" />
                </Field>
                <Field label="WhatsApp" hint="Com DDD, ex.: 11 98765-4321">
                  <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} inputMode="tel" placeholder="11 98765-4321" />
                </Field>
              </div>
            )}
          </fieldset>

          <Field label="Serviço">
            <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
              <option value="">Escolha…</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.duration_min} min · {money(s.price)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Dia">
            <input type="date" value={day} min={todayKey()} onChange={(e) => setDay(e.target.value)} required />
          </Field>

          <div className="span-2">
            <span className="field-label">Horários livres</span>
            {!serviceId ? (
              <p className="muted small">Escolha o serviço para ver os horários livres.</p>
            ) : slots === 'loading' ? (
              <Loading label="Buscando horários…" />
            ) : slots?.length === 0 ? (
              <p className="muted small">Sem horários livres neste dia. Tente outro dia.</p>
            ) : (
              <div className="slots">
                {slots?.map((s) => (
                  <button
                    key={s.slot_start}
                    type="button"
                    className={`slot ${slot?.slot_start === s.slot_start ? 'is-active' : ''}`}
                    onClick={() => setSlot(s)}
                  >
                    {fmtTime(s.slot_start)}
                  </button>
                ))}
              </div>
            )}
            {service && slot && (
              <p className="small slot-summary">
                {service.name}, das {fmtTime(slot.slot_start)} às {fmtTime(slot.slot_end)}.
              </p>
            )}
          </div>

          <Field label="Observações (opcional)" className="span-2">
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          <div className="span-2">
            <ErrorBox>{error}</ErrorBox>
          </div>
        </form>
      )}
    </Modal>
  )
}
