import { useCallback, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { me, logout } from './lib/auth'
import type { Instance } from './types'
import ContactsTab from './components/ContactsTab'
import SessionsTab from './components/SessionsTab'
import CasesTab from './components/CasesTab'
import Login from './components/Login'

type Tab = 'contatos' | 'sessoes' | 'casos'
type AuthState = 'loading' | 'authed' | 'guest'

export default function App() {
  const [auth, setAuth] = useState<AuthState>('loading')
  const [instances, setInstances] = useState<Instance[]>([])
  const [instancesError, setInstancesError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('contatos')

  useEffect(() => {
    void me().then((ok) => setAuth(ok ? 'authed' : 'guest'))
  }, [])

  async function doLogout() {
    await logout()
    setAuth('guest')
  }

  const loadInstances = useCallback(async () => {
    const { data, error } = await supabase
      .from('radar_pe_instances')
      .select('*')
      .order('name')

    if (error) {
      setInstancesError(error.message)
    } else {
      setInstances((data ?? []) as Instance[])
    }
  }, [])

  useEffect(() => {
    void loadInstances()
  }, [loadInstances])

  if (auth === 'loading') {
    return <div className="state">Carregando…</div>
  }

  if (auth === 'guest') {
    return <Login onSuccess={() => setAuth('authed')} />
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>Botando pra Moer</h1>
        <button type="button" className="logout-btn" onClick={() => void doLogout()}>
          Sair
        </button>
      </header>

      <nav className="tabs">
        <button
          type="button"
          className={`tab ${activeTab === 'contatos' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('contatos')}
        >
          Contatos
        </button>
        <button
          type="button"
          className={`tab ${activeTab === 'sessoes' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('sessoes')}
        >
          Sessões
        </button>
        <button
          type="button"
          className={`tab ${activeTab === 'casos' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('casos')}
        >
          Casos pro Radar
        </button>
      </nav>

      {instancesError && <div className="error">Erro: {instancesError}</div>}

      {activeTab === 'contatos' ? (
        <ContactsTab instances={instances} />
      ) : activeTab === 'sessoes' ? (
        <SessionsTab instances={instances} onChanged={() => void loadInstances()} />
      ) : (
        <CasesTab instances={instances} />
      )}
    </div>
  )
}
