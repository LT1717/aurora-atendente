import { useState } from 'react'
import { signIn } from '../lib/api'
import { friendlyError } from '../lib/format'
import { ErrorBox, Field } from '../components/ui'
import { Brand } from '../components/Layout'
import Icon from '../components/Icon'
import LangSwitch from '../components/LangSwitch'
import { t } from '../lib/i18n'

const DEMO_EMAIL = import.meta.env.VITE_DEMO_EMAIL
const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function enter(e, creds) {
    e?.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signIn(creds?.email ?? email, creds?.password ?? password)
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <section className="login-art" aria-hidden="true">
        <Brand />
        <div className="login-art-copy">
          <p className="login-quote">{t('Atendimento no WhatsApp 24 horas, com agenda sempre em dia.')}</p>
          <ul className="login-points">
            <li><Icon name="chat" /> {t('A assistente responde dúvidas sobre serviços, preços e endereço')}</li>
            <li><Icon name="calendar" /> {t('Consulta horários livres e agenda sozinha')}</li>
            <li><Icon name="bell" /> {t('Envia lembrete na véspera e registra a confirmação')}</li>
            <li><Icon name="hand" /> {t('Passa a conversa para a recepção quando é preciso')}</li>
          </ul>
        </div>
        <div className="login-sun" />
      </section>

      <section className="login-form-wrap">
        <LangSwitch className="login-lang" />
        <form className="login-form" onSubmit={enter}>
          <h1>{t('Entrar no painel')}</h1>
          <p className="muted">{t('Acesso da equipe da Clínica Aurora Estética.')}</p>

          <Field label={t('E-mail')}>
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t('Senha')}>
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>

          <ErrorBox>{error}</ErrorBox>

          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? t('Entrando…') : t('Entrar')}
          </button>

          {DEMO_EMAIL && DEMO_PASSWORD && (
            <div className="demo-box">
              <p>
                <strong>{t('Demonstração aberta.')}</strong> {t('Os dados são fictícios e você pode mexer à vontade.')}
              </p>
              <dl>
                <dt>{t('E-mail')}</dt>
                <dd>{DEMO_EMAIL}</dd>
                <dt>{t('Senha')}</dt>
                <dd>{DEMO_PASSWORD}</dd>
              </dl>
              <button
                type="button"
                className="btn btn-soft btn-block"
                disabled={busy}
                onClick={() => enter(null, { email: DEMO_EMAIL, password: DEMO_PASSWORD })}
              >
                {t('Entrar com a conta de demonstração')}
              </button>
            </div>
          )}
        </form>
      </section>
    </div>
  )
}
