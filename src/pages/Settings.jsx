import { useEffect, useState } from 'react'
import { getAiUsageToday, getSettings, saveSettings } from '../lib/api'
import { friendlyError } from '../lib/format'
import { ErrorBox, Field, Loading, Switch, useToast } from '../components/ui'
import Icon from '../components/Icon'
import { t } from '../lib/i18n'

export default function Settings() {
  const toast = useToast()
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [usage, setUsage] = useState(0)

  useEffect(() => {
    getSettings().then(setForm).catch((err) => setError(friendlyError(err)))
    getAiUsageToday().then(setUsage).catch(() => {})
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
        ai_enabled: !!form.ai_enabled,
        ai_daily_limit: Math.max(0, Math.min(5000, Number(form.ai_daily_limit) || 0)),
      })
      toast(t('Configurações salvas.'))
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
          <p className="page-date">{t('Clínica e assistente')}</p>
          <h1>{t('Configurações')}</h1>
        </div>
        <button className="btn btn-primary" disabled={busy}>
          <Icon name="check" /> {busy ? t('Salvando…') : t('Salvar')}
        </button>
      </header>

      <ErrorBox>{error}</ErrorBox>

      <section className="panel">
        <div className="switch-row big">
          <Switch checked={form.bot_enabled} onChange={(v) => setForm((f) => ({ ...f, bot_enabled: v }))} label={t('Assistente ligada')} />
          <div>
            <strong>{form.bot_enabled ? t('Assistente ligada') : t('Assistente desligada')}</strong>
            <p className="muted small">
              {form.bot_enabled
                ? t('A assistente responde automaticamente no WhatsApp, exceto nas conversas que a recepção assumiu.')
                : t('Ninguém recebe resposta automática. Todas as mensagens ficam para a recepção.')}
            </p>
          </div>
        </div>
        <div className="switch-row big ai-row">
          <Switch
            checked={!!form.ai_enabled}
            onChange={(v) => setForm((f) => ({ ...f, ai_enabled: v }))}
            label={t('Inteligência artificial ligada')}
          />
          <div className="ai-row-text">
            <strong>{form.ai_enabled ? t('Inteligência artificial ligada') : t('Inteligência artificial desligada')}</strong>
            <p className="muted small">
              {form.ai_enabled
                ? t('A IA responde a qualquer pergunta com base no texto abaixo e agenda sozinha nos horários livres.')
                : t('A assistente usa respostas automáticas por palavras-chave (preços, endereço, horários).')}
            </p>
          </div>
          <Field label={t('Limite de respostas da IA por dia')} hint={t('Hoje: {a} de {b}', { a: usage, b: form.ai_daily_limit ?? 200 })}>
            <input
              type="number"
              min={0}
              max={5000}
              value={form.ai_daily_limit ?? 200}
              onChange={(e) => setForm((f) => ({ ...f, ai_daily_limit: e.target.value }))}
            />
          </Field>
        </div>
      </section>

      <div className="settings-grid">
        <section className="panel">
          <header className="panel-head"><h2>{t('Dados da clínica')}</h2></header>
          <div className="form-grid one">
            <Field label={t('Nome')}><input value={form.name || ''} onChange={set('name')} required /></Field>
            <Field label={t('Telefone')}><input value={form.phone || ''} onChange={set('phone')} /></Field>
            <Field label={t('Endereço')}><textarea rows={2} value={form.address || ''} onChange={set('address')} /></Field>
            <Field label={t('Mensagem de boas-vindas')} hint={t('Enviada no primeiro contato de um número novo.')}>
              <textarea rows={4} value={form.welcome_message || ''} onChange={set('welcome_message')} />
            </Field>
          </div>
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2>{t('O que a assistente sabe')}</h2>
            <span className="muted small">{t('{n} palavras', { n: words })}</span>
          </header>
          <p className="muted small kb-hint">
            {t('A assistente responde apenas com base neste texto, nos serviços e nos horários cadastrados. Se algo não estiver aqui, ela passa a conversa para a recepção em vez de inventar.')}
          </p>
          <textarea className="kb" value={form.info_ia || ''} onChange={set('info_ia')} aria-label={t('Informações para a assistente')} />
        </section>
      </div>
    </form>
  )
}
