import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { listConversations, listMessages, sendHumanMessage, setBotPaused, subscribeToChanges } from '../lib/api'
import { dayKey, fmtPhone, fmtRelativeDay, fmtTime, fmtWhen, friendlyError } from '../lib/format'
import { Avatar, Badge, Empty, ErrorBox, Loading, useToast } from '../components/ui'
import Icon from '../components/Icon'
import { t } from '../lib/i18n'

const SENDER = { cliente: 'Cliente', bot: 'Aurora · assistente IA', humano: 'Recepção' }

export default function Conversations() {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('c')
  const [convs, setConvs] = useState(null)
  const [messages, setMessages] = useState(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef(null)

  const loadList = useCallback(() => {
    listConversations()
      .then((rows) => {
        setConvs(rows)
        setError('')
      })
      .catch((err) => setError(friendlyError(err)))
  }, [])

  const loadThread = useCallback(() => {
    if (!selectedId) return setMessages(null)
    listMessages(selectedId).then(setMessages).catch((err) => setError(friendlyError(err)))
  }, [selectedId])

  useEffect(loadList, [loadList])
  useEffect(() => {
    setMessages(null)
    loadThread()
  }, [loadThread])

  // tempo real: quando chega mensagem nova, atualiza a lista e a conversa aberta
  useEffect(
    () =>
      subscribeToChanges(() => {
        loadList()
        loadThread()
      }),
    [loadList, loadThread],
  )

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  const current = convs?.find((c) => c.id === selectedId)

  async function toggleBot() {
    try {
      await setBotPaused(current.id, !current.bot_paused)
      toast(current.bot_paused ? t('A assistente voltou a responder esta conversa.') : t('Você assumiu a conversa. A assistente está pausada.'))
      loadList()
    } catch (err) {
      toast(friendlyError(err), 'danger')
    }
  }

  async function send(e) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    setSending(true)
    try {
      const result = await sendHumanMessage(current, text)
      if (!result.ok) toast(result.error, 'danger')
      setDraft('')
      loadThread()
      loadList()
    } catch (err) {
      toast(friendlyError(err), 'danger')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="page page-full">
      <header className="page-head">
        <div>
          <p className="page-date">{t('WhatsApp e simulador')}</p>
          <h1>{t('Conversas')}</h1>
        </div>
        <Link to="/simulador" className="btn btn-ghost">
          <Icon name="phone" /> {t('Abrir simulador')}
        </Link>
      </header>
      <ErrorBox>{error}</ErrorBox>

      <div className={`chat ${selectedId ? 'has-thread' : ''}`}>
        <aside className="chat-list" aria-label={t('Conversas')}>
          {!convs ? (
            <Loading />
          ) : convs.length === 0 ? (
            <Empty icon="chat" title={t('Nenhuma conversa ainda')}>{t('As mensagens do WhatsApp aparecem aqui.')}</Empty>
          ) : (
            <ul>
              {convs.map((c) => {
                const last = c.messages?.[0]
                return (
                  <li key={c.id}>
                    <button
                      className={`chat-item ${c.id === selectedId ? 'is-active' : ''}`}
                      onClick={() => setParams({ c: c.id })}
                    >
                      <Avatar name={c.name} />
                      <div className="chat-item-body">
                        <div className="chat-item-top">
                          <strong>{c.name || fmtPhone(c.phone)}</strong>
                          <time>{fmtWhen(c.last_message_at)}</time>
                        </div>
                        <div className="chat-item-bottom">
                          <span className="clip">
                            {last?.sender === 'bot' && <Icon name="bot" size={14} />}
                            {last?.sender === 'humano' && <Icon name="user" size={14} />}
                            {last?.body}
                          </span>
                          {c.needs_human ? (
                            <span className="dot dot-danger" title={t('Aguardando a recepção')} />
                          ) : c.bot_paused ? (
                            <span className="dot dot-warn" title={t('Assistente pausada')} />
                          ) : null}
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>

        <section className="chat-thread">
          {!current ? (
            <Empty icon="chat" title={t('Escolha uma conversa')}>
              {t('Aqui você vê o que a assistente respondeu e pode assumir o atendimento a qualquer momento.')}
            </Empty>
          ) : (
            <>
              <header className="thread-head">
                <button className="icon-btn thread-back" onClick={() => setParams({})} aria-label={t('Voltar à lista')}>
                  <Icon name="left" />
                </button>
                <Avatar name={current.name} />
                <div className="thread-who">
                  <strong>{current.name || t('Sem nome')}</strong>
                  <span>
                    {fmtPhone(current.phone)} · {current.channel === 'whatsapp' ? 'WhatsApp' : t('Simulador')}
                  </span>
                </div>
                <div className="thread-status">
                  {current.needs_human && <Badge tone="danger">{t('Pediu atendente')}</Badge>}
                  {current.bot_paused ? <Badge tone="warn">{t('Assistente pausada')}</Badge> : <Badge tone="ok">{t('Assistente ativa')}</Badge>}
                </div>
                <button className={`btn ${current.bot_paused ? 'btn-soft' : 'btn-primary'}`} onClick={toggleBot}>
                  <Icon name={current.bot_paused ? 'bot' : 'hand'} />
                  {current.bot_paused ? t('Devolver à assistente') : t('Assumir conversa')}
                </button>
              </header>

              <div className="thread-body">
                {!messages ? (
                  <Loading />
                ) : (
                  <ol className="bubbles">
                    {messages.map((m, i) => {
                      const showDay = i === 0 || dayKey(messages[i - 1].created_at) !== dayKey(m.created_at)
                      return (
                        <li key={m.id} className="bubble-row-wrap">
                          {showDay && <div className="day-sep">{fmtRelativeDay(dayKey(m.created_at))}</div>}
                          <div className={`bubble-row from-${m.sender}`}>
                            <div className="bubble">
                              {m.sender !== 'cliente' && <span className="bubble-author">{t(SENDER[m.sender])}</span>}
                              <p>{m.body}</p>
                              <time>
                                {fmtTime(m.created_at)}
                                {m.status === 'enviada' && ' ✓'}
                                {m.status === 'falhou' && ` · ${t('não enviada')}`}
                              </time>
                              {m.status === 'falhou' && m.error && <span className="bubble-error">{m.error}</span>}
                            </div>
                          </div>
                        </li>
                      )
                    })}
                    <li ref={endRef} />
                  </ol>
                )}
              </div>

              {current.bot_paused ? (
                <form className="composer" onSubmit={send}>
                  <textarea
                    rows={1}
                    placeholder={t('Responder como recepção…')}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) send(e)
                    }}
                    aria-label={t('Mensagem')}
                  />
                  <button className="btn btn-primary" disabled={sending || !draft.trim()} aria-label={t('Enviar')}>
                    <Icon name="send" />
                  </button>
                </form>
              ) : (
                <div className="composer composer-locked">
                  <Icon name="bot" />
                  <span>{t('A assistente está respondendo. Clique em')} <strong>{t('Assumir conversa')}</strong> {t('para escrever.')}</span>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
