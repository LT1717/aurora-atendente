import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { deleteCustomer, listCustomers, saveCustomer } from '../lib/api'
import { STAGES, fmtPhone, fmtWhen, friendlyError, normalizePhone } from '../lib/format'
import { Avatar, Badge, Empty, ErrorBox, Field, Loading, Modal, Switch, useToast } from '../components/ui'
import Icon from '../components/Icon'

export default function Customers() {
  const toast = useToast()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState('')
  const [editing, setEditing] = useState(null)

  const load = useCallback(() => {
    listCustomers()
      .then((r) => {
        setRows(r)
        setError('')
      })
      .catch((err) => setError(friendlyError(err)))
  }, [])
  useEffect(load, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    return (rows || []).filter(
      (c) =>
        (!stage || c.stage === stage) &&
        (!q || c.name?.toLowerCase().includes(q) || (digits && c.phone.includes(digits))),
    )
  }, [rows, query, stage])

  async function remove(c) {
    if (!confirm(`Excluir ${c.name || 'este cliente'}? Os agendamentos e conversas dele também serão apagados.`)) return
    try {
      await deleteCustomer(c.id)
      toast('Cliente excluído.')
      setEditing(null)
      load()
    } catch (err) {
      toast(friendlyError(err), 'danger')
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-date">{rows ? `${rows.length} contatos` : ' '}</p>
          <h1>Clientes</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing({ name: '', phone: '', notes: '', stage: 'novo', bot_paused: false })}>
          <Icon name="plus" /> Novo cliente
        </button>
      </header>

      <div className="toolbar">
        <div className="search">
          <Icon name="search" />
          <input type="search" placeholder="Buscar por nome ou telefone" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar" />
        </div>
        <div className="chips" role="group" aria-label="Filtrar por etapa">
          <button className={`chip ${!stage ? 'is-active' : ''}`} onClick={() => setStage('')}>Todos</button>
          {Object.entries(STAGES).map(([k, s]) => (
            <button key={k} className={`chip ${stage === k ? 'is-active' : ''}`} onClick={() => setStage(k)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <ErrorBox>{error}</ErrorBox>

      <section className="panel panel-flush">
        {!rows ? (
          <Loading />
        ) : filtered.length === 0 ? (
          <Empty icon="users" title="Nenhum cliente encontrado">Tente outra busca ou outro filtro.</Empty>
        ) : (
          <table className="table table-customers">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>WhatsApp</th>
                <th>Etapa</th>
                <th className="num">Agendamentos</th>
                <th>Último contato</th>
                <th><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} onClick={() => setEditing(c)} className="row-click">
                  <td>
                    <div className="cell-person">
                      <Avatar name={c.name} />
                      <div>
                        <strong>{c.name || 'Sem nome'}</strong>
                        {c.notes && <span className="muted small clip">{c.notes}</span>}
                      </div>
                    </div>
                  </td>
                  <td className="nowrap">{fmtPhone(c.phone)}</td>
                  <td>
                    <Badge tone={STAGES[c.stage]?.tone}>{STAGES[c.stage]?.label}</Badge>
                    {c.bot_paused && <Badge tone="warn">Assistente pausada</Badge>}
                  </td>
                  <td className="num">{c.appointments?.[0]?.count ?? 0}</td>
                  <td className="muted">{c.last_message_at ? fmtWhen(c.last_message_at) : '—'}</td>
                  <td className="actions">
                    {c.last_message_at && (
                      <Link to={`/conversas?c=${c.id}`} className="icon-btn" onClick={(e) => e.stopPropagation()} aria-label="Abrir conversa">
                        <Icon name="chat" />
                      </Link>
                    )}
                    <button className="icon-btn" aria-label="Editar"><Icon name="edit" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {editing && (
        <CustomerForm
          customer={editing}
          onClose={() => setEditing(null)}
          onDelete={() => remove(editing)}
          onSaved={() => {
            setEditing(null)
            toast('Cliente salvo.')
            load()
          }}
        />
      )}
    </div>
  )
}

function CustomerForm({ customer, onClose, onSaved, onDelete }) {
  const [form, setForm] = useState({ ...customer, phone: customer.id ? fmtPhone(customer.phone) : customer.phone })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))

  async function save(e) {
    e.preventDefault()
    const phone = normalizePhone(form.phone)
    if (phone.length < 12) return setError('Informe o WhatsApp com DDD, ex.: 11 98765-4321.')
    setBusy(true)
    try {
      await saveCustomer({
        id: form.id,
        name: form.name?.trim() || null,
        phone,
        notes: form.notes?.trim() || null,
        stage: form.stage,
        bot_paused: form.bot_paused,
        ...(form.bot_paused ? {} : { needs_human: false }),
      })
      onSaved()
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={form.id ? 'Editar cliente' : 'Novo cliente'}
      onClose={onClose}
      footer={
        <>
          {form.id && (
            <button type="button" className="btn btn-danger-ghost push-left" onClick={onDelete}>
              <Icon name="trash" /> Excluir
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" form="customer-form" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
        </>
      }
    >
      <form id="customer-form" className="form-grid" onSubmit={save}>
        <Field label="Nome" className="span-2">
          <input value={form.name || ''} onChange={set('name')} />
        </Field>
        <Field label="WhatsApp" hint="Com DDD">
          <input value={form.phone} onChange={set('phone')} inputMode="tel" required />
        </Field>
        <Field label="Etapa">
          <select value={form.stage} onChange={set('stage')}>
            {Object.entries(STAGES).map(([k, s]) => (
              <option key={k} value={k}>{s.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Observações" className="span-2">
          <textarea rows={3} value={form.notes || ''} onChange={set('notes')} />
        </Field>
        <div className="span-2 switch-row">
          <Switch checked={!form.bot_paused} onChange={(on) => setForm((f) => ({ ...f, bot_paused: !on }))} label="Assistente responde a este cliente" />
          <div>
            <strong>Assistente responde a este cliente</strong>
            <p className="muted small">Desligue para que só a recepção responda a este número.</p>
          </div>
        </div>
        <div className="span-2"><ErrorBox>{error}</ErrorBox></div>
      </form>
    </Modal>
  )
}
