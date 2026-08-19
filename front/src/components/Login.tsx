import { useState, type FormEvent } from 'react'
import { login } from '../lib/auth'
import logo from '../assets/logoc5.png'

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(password)
      onSuccess()
    } catch {
      setError('Senha incorreta')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-stack">
        <img className="login-logo" src={logo} alt="Logo" />
        <form className="login-card" onSubmit={submit}>
          <h1>Botando pra Moer</h1>
          <p className="login-sub">Digite a senha para acessar o painel.</p>
          <input
            type="password"
            className="search"
            placeholder="Senha"
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <div className="login-error">{error}</div>}
          <button type="submit" className="login-btn" disabled={loading || !password}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
          <p className="login-warn">Acesso restrito — uso exclusivamente interno.</p>
        </form>
      </div>
    </div>
  )
}
