import { useCallback, useEffect, useState } from 'react'
import { deleteService, listServices, saveService } from '../lib/api'
import { friendlyError, money } from '../lib/format'
import { Badge, Empty, ErrorBox, Field, Loading, Modal, Switch, useToast } from '../components/ui'
import Icon from '../components/Icon'
import { t } from '../lib/i18n'

const BLANK = { name: '', description: '', duration_min: 60, price: 0, active: true }

export default function Services() {
  const toast = useToast()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)

  const load = useCallback(() => {
    listServices()
      .then((r) => {
        setRows(r)
        setError('')
      })
      .catch((err) => setError(friendlyError(err)))
  }, [])
  useEffect(load, [load])

  async function toggle(s) {
    try {
      await saveService({ id: s.id, active: !s.active })
      toast(s.active ? t('Serviço desativado. A assistente deixa de oferecê-lo.') : t('Serviço ativado.'))
      load()
    } catch (err) {
      toast(friendlyError(err), 'danger')
    }
  }

  async function remove(s) {
    if (!confirm(t('Excluir o serviço “{n}”?', { n: s.name }))) return
    try {
      await deleteService(s.id)
      toast(t('Serviço excluído.'))
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
          <p className="page-date">{t('O que a assistente pode agendar')}</p>
          <h1>{t('Serviços')}</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing(BLANK)}>
          <Icon name="plus" /> {t('Novo serviço')}
        </button>
      </header>
      <ErrorBox>{error}</ErrorBox>

      <section className="panel panel-flush">
        {!rows ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty icon="sparkles" title={t('Nenhum serviço cadastrado')}>{t('Cadastre o primeiro para começar a agendar.')}</Empty>
        ) : (
          <table className="table table-services">
            <thead>
              <tr>
                <th>{t('Serviço')}</th>
                <th className="num">{t('Duração')}</th>
                <th className="num">{t('Preço')}</th>
                <th>{t('Ativo')}</th>
                <th><span className="sr-only">{t('Ações')}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={`row-click ${s.active ? '' : 'is-off'}`} onClick={() => setEditing(s)}>
                  <td>
                    <strong>{s.name}</strong>
                    {s.description && <span className="muted small block">{s.description}</span>}
                  </td>
                  <td className="num nowrap">{s.duration_min} min</td>
                  <td className="num nowrap">{Number(s.price) === 0 ? <Badge tone="ok">{t('Gratuito')}</Badge> : money(s.price)}</td>
                  <td onClick={(e) => e.stopPropagation()}><Switch checked={s.active} onChange={() => toggle(s)} label={`${t('Ativar')} ${s.name}`} /></td>
                  <td className="actions">
                    <button className="icon-btn" aria-label={`${t('Editar')} ${s.name}`}><Icon name="edit" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {editing && (
        <ServiceForm
          service={editing}
          onClose={() => setEditing(null)}
          onDelete={() => remove(editing)}
          onSaved={() => {
            setEditing(null)
            toast(t('Serviço salvo.'))
            load()
          }}
        />
      )}
    </div>
  )
}

function ServiceForm({ service, onClose, onSaved, onDelete }) {
  const [form, setForm] = useState(service)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    try {
      await saveService({
        id: form.id,
        name: form.name.trim(),
        description: form.description?.trim() || null,
        duration_min: Number(form.duration_min),
        price: Number(String(form.price).replace(',', '.')),
        active: form.active,
      })
      onSaved()
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={form.id ? t('Editar serviço') : t('Novo serviço')}
      onClose={onClose}
      footer={
        <>
          {form.id && (
            <button type="button" className="btn btn-danger-ghost push-left" onClick={onDelete}>
              <Icon name="trash" /> {t('Excluir')}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('Cancelar')}</button>
          <button className="btn btn-primary" form="service-form" disabled={busy}>{busy ? t('Salvando…') : t('Salvar')}</button>
        </>
      }
    >
      <form id="service-form" className="form-grid" onSubmit={save}>
        <Field label={t('Nome')} className="span-2">
          <input value={form.name} onChange={set('name')} required />
        </Field>
        <Field label={t('Descrição')} hint={t('A assistente usa este texto para explicar o serviço.')} className="span-2">
          <textarea rows={2} value={form.description || ''} onChange={set('description')} />
        </Field>
        <Field label={t('Duração (minutos)')}>
          <input type="number" min={5} max={480} step={5} value={form.duration_min} onChange={set('duration_min')} required />
        </Field>
        <Field label={t('Preço (R$)')}>
          <input inputMode="decimal" value={form.price} onChange={set('price')} required />
        </Field>
        <div className="span-2"><ErrorBox>{error}</ErrorBox></div>
      </form>
    </Modal>
  )
}
