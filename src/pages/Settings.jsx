import { useEffect, useState } from 'react'
import { getSettings, saveSettings } from '../lib/api'
import { friendlyError } from '../lib/format'
import { ErrorBox, Field, Loading, Switch, useToast } from '../components/ui'
import Icon from '../components/Icon'

export default function Settings() {
  const toast = useToast()
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getSettings().then(setForm).catch((err) => setError(friendlyError(err)))
  }, [])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await saveSettings({
        name: form.name.trim(),
        phone: form.phone?.trim() || null,
        address: form.address?.trim() || null,
        welcome_message: form.welcome_message?.trim() || null,
        info_ia: form.info_ia?.trim() || null,
        bot_enabled: form.bot_enabled,
      })
      toast('Configurações salvas.')
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  if (!form) return error ? <div className="page"><ErrorBox>{error}</ErrorBox></div> : <Loading />

  const words = (form.info_ia || '').trim().split(/\s+/).filter(Boolean).length

  return (
    <form className="page" onSubmit={save}>
      <header className="page-head">
        <div>
          <p className="page-date">Clínica e assistente</p>
          <h1>Configurações</h1>
        </div>
        <button className="btn btn-primary" disabled={busy}>
          <Icon name="check" /> {busy ? 'Salvando…' : 'Salvar'}
        </button>
      </header>

      <ErrorBox>{error}</ErrorBox>

      <section className="panel">
        <div className="switch-row big">
          <Switch checked={form.bot_enabled} onChange={(v) => setForm((f) => ({ ...f, bot_enabled: v }))} label="Assistente ligada" />
          <div>
            <strong>{form.bot_enabled ? 'Assistente ligada' : 'Assistente desligada'}</strong>
            <p className="muted small">
              {form.bot_enabled
                ? 'A assistente responde automaticamente no WhatsApp, exceto nas conversas que a recepção assumiu.'
                : 'Ninguém recebe resposta automática. Todas as mensagens ficam para a recepção.'}
            </p>
          </div>
        </div>
      </section>

      <div className="settings-grid">
        <section className="panel">
          <header className="panel-head"><h2>Dados da clínica</h2></header>
          <div className="form-grid one">
            <Field label="Nome"><input value={form.name || ''} onChange={set('name')} required /></Field>
            <Field label="Telefone"><input value={form.phone || ''} onChange={set('phone')} /></Field>
            <Field label="Endereço"><textarea rows={2} value={form.address || ''} onChange={set('address')} /></Field>
            <Field label="Mensagem de boas-vindas" hint="Enviada no primeiro contato de um número novo.">
              <textarea rows={4} value={form.welcome_message || ''} onChange={set('welcome_message')} />
            </Field>
          </div>
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2>O que a assistente sabe</h2>
            <span className="muted small">{words} palavras</span>
          </header>
          <p className="muted small kb-hint">
            A assistente responde <strong>apenas</strong> com base neste texto, nos serviços e nos horários cadastrados.
            Se algo não estiver aqui, ela passa a conversa para a recepção em vez de inventar.
          </p>
          <textarea className="kb" value={form.info_ia || ''} onChange={set('info_ia')} aria-label="Informações para a assistente" />
        </section>
      </div>
    </form>
  )
}
