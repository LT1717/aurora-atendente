import { useLang } from '../lib/i18n'

/** Botão PT | EN */
export default function LangSwitch({ className = '' }) {
  const { lang, setLang } = useLang()
  return (
    <div className={`lang-switch ${className}`} role="group" aria-label="Idioma / Language">
      {[
        ['pt', 'PT'],
        ['en', 'EN'],
      ].map(([code, label]) => (
        <button
          key={code}
          type="button"
          className={lang === code ? 'is-active' : ''}
          aria-pressed={lang === code}
          onClick={() => setLang(code)}
          title={code === 'pt' ? 'Português' : 'English'}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
