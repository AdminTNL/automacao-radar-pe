import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import { me, logout } from './lib/auth'
import { isOfflineError } from './lib/errors'
import { useAutoRefresh } from './lib/useAutoRefresh'
import logo from './assets/logoc5.png'
import type { Instance } from './types'
import ContactsTab from './components/ContactsTab'
import SessionsTab from './components/SessionsTab'
import CasesTab from './components/CasesTab'
import AudiosTab from './components/AudiosTab'
import RadarTab from './components/RadarTab'
import MissionsTab from './components/MissionsTab'
import Login from './components/Login'

type Tab = 'contatos' | 'sessoes' | 'casos' | 'audios' | 'radar' | 'missoes'
type AuthState = 'loading' | 'authed' | 'guest'

export default function App() {
  const [auth, setAuth] = useState<AuthState>('loading')
  const [instances, setInstances] = useState<Instance[]>([])
  const [instancesError, setInstancesError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('contatos')
  const [newCasesCount, setNewCasesCount] = useState(0)
  const [newMissoesCount, setNewMissoesCount] = useState(0)
  const lastSeenRef = useRef<string | null>(null)

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
      if (isOfflineError(error)) {
        setOffline(true)
        setInstancesError(null)
      } else {
        setOffline(false)
        setInstancesError(error.message)
      }
    } else {
      setOffline(false)
      setInstancesError(null)
      setInstances((data ?? []) as Instance[])
    }
  }, [])

  useEffect(() => {
    if (auth !== 'authed') return
    void loadInstances()
  }, [auth, loadInstances])

  useAutoRefresh(() => {
    void loadInstances()
  }, 60000)

  const checkNewCases = useCallback(async () => {
    if (lastSeenRef.current === null) {
      const { data, error } = await supabase
        .from('radar_pe_cases')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1)
      if (!error && data && data.length > 0) {
        lastSeenRef.current = (data[0] as { created_at: string }).created_at
      }
      return
    }

    const since = lastSeenRef.current
    const { data, error } = await supabase
      .from('radar_pe_cases')
      .select('created_at')
      .gt('created_at', since)
      .order('created_at', { ascending: false })

    if (error || !data || data.length === 0) return

    lastSeenRef.current = (data[0] as { created_at: string }).created_at

    if (activeTab !== 'casos') {
      setNewCasesCount((n) => n + data.length)
    }
  }, [activeTab])

  useAutoRefresh(() => {
    void checkNewCases()
  }, 60000)

  const checkNewMissoes = useCallback(async () => {
    const { count, error } = await supabase
      .from('radar_pe_missoes_capturadas')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'nova')
    if (!error) setNewMissoesCount(count ?? 0)
  }, [])

  useEffect(() => {
    if (auth !== 'authed') return
    void checkNewMissoes()
  }, [auth, checkNewMissoes])

  useAutoRefresh(() => {
    void checkNewMissoes()
  }, 60000)

  const openTab = (tab: Tab) => {
    if (tab === 'casos') setNewCasesCount(0)
    if (tab === 'missoes') setNewMissoesCount(0)
    setActiveTab(tab)
  }

  if (auth === 'loading') {
    return <div className="state">Carregando…</div>
  }

  if (auth === 'guest') {
    return <Login onSuccess={() => setAuth('authed')} />
  }

  return (
    <div className="app">
      <header className="topbar">
        <img className="logo" src={logo} alt="Logo" />
        <h1>Botando pra Moer</h1>
        <span className="subtitle">Atualiza a cada 60s</span>
        <button type="button" className="logout-btn" onClick={() => void doLogout()}>
          Sair
        </button>
      </header>

      <nav className="tabs">
        <button
          type="button"
          className={`tab ${activeTab === 'contatos' ? 'tab-active' : ''}`}
          onClick={() => openTab('contatos')}
        >
          Contatos
        </button>
        <button
          type="button"
          className={`tab ${activeTab === 'sessoes' ? 'tab-active' : ''}`}
          onClick={() => openTab('sessoes')}
        >
          Sessões
        </button>
        <button
          type="button"
          className={`tab ${activeTab === 'missoes' ? 'tab-active' : ''}`}
          onClick={() => openTab('missoes')}
        >
          Missões
          <span className={`tab-badge${newMissoesCount > 0 ? '' : ' tab-badge-empty'}`}>
            {newMissoesCount > 0 ? newMissoesCount : 0}
          </span>
        </button>
        <button
          type="button"
          className={`tab ${activeTab === 'casos' ? 'tab-active' : ''}`}
          onClick={() => openTab('casos')}
        >
          Casos pro Radar
          <span className={`tab-badge${newCasesCount > 0 ? '' : ' tab-badge-empty'}`}>
            {newCasesCount > 0 ? newCasesCount : 0}
          </span>
        </button>
        <button
          type="button"
          className={`tab ${activeTab === 'audios' ? 'tab-active' : ''}`}
          onClick={() => openTab('audios')}
        >
          Áudios pra Campanha
        </button>
        <button
          type="button"
          className={`tab ${activeTab === 'radar' ? 'tab-active' : ''}`}
          onClick={() => openTab('radar')}
        >
          Radar Mobiliza PE
        </button>
      </nav>

      {offline ? (
        <div className="offline-banner">Sistema temporariamente fora do ar — tentando reconectar…</div>
      ) : instancesError ? (
        <div className="error">Erro: {instancesError}</div>
      ) : null}

      {activeTab === 'contatos' ? (
        <ContactsTab instances={instances} offline={offline} />
      ) : activeTab === 'sessoes' ? (
        <SessionsTab instances={instances} offline={offline} onChanged={() => void loadInstances()} />
      ) : activeTab === 'casos' ? (
        <CasesTab instances={instances} offline={offline} />
      ) : activeTab === 'radar' ? (
        <RadarTab offline={offline} />
      ) : activeTab === 'missoes' ? (
        <MissionsTab offline={offline} />
      ) : (
        <AudiosTab instances={instances} offline={offline} />
      )}
    </div>
  )
}
