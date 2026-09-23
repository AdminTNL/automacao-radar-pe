import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import { me } from './lib/auth'
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

const TABS: { id: Tab; label: string; short: string }[] = [
  { id: 'contatos', label: 'Contatos', short: 'Contatos' },
  { id: 'sessoes', label: 'Sessões', short: 'Sessões' },
  { id: 'missoes', label: 'Missões', short: 'Missões' },
  { id: 'casos', label: 'Casos pro Radar', short: 'Casos' },
  { id: 'audios', label: 'Áudios pra Campanha', short: 'Áudios' },
  { id: 'radar', label: 'Radar Mobiliza PE', short: 'Radar' },
]

function TabIcon({ tab }: { tab: Tab }) {
  switch (tab) {
    case 'contatos':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      )
    case 'sessoes':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="2" width="14" height="20" rx="2" />
          <line x1="12" y1="18" x2="12.01" y2="18" />
        </svg>
      )
    case 'missoes':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      )
    case 'casos':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <line x1="4" y1="22" x2="4" y2="15" />
        </svg>
      )
    case 'audios':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
        </svg>
      )
    case 'radar':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.9 19.1a10 10 0 0 1 0-14.2" />
          <path d="M19.1 4.9a10 10 0 0 1 0 14.2" />
          <path d="M7.8 16.2a6 6 0 0 1 0-8.4" />
          <path d="M16.2 7.8a6 6 0 0 1 0 8.4" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      )
  }
  return null
}

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
  }, 10000)

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
      </header>

      <nav className="tabs">
        {TABS.map((t) => {
          const badge = t.id === 'missoes' ? newMissoesCount : t.id === 'casos' ? newCasesCount : null
          return (
            <button
              key={t.id}
              type="button"
              className={`tab ${activeTab === t.id ? 'tab-active' : ''}`}
              onClick={() => openTab(t.id)}
            >
              <span className="tab-icon" aria-hidden="true">
                <TabIcon tab={t.id} />
              </span>
              <span className="tab-label tab-label-full">{t.label}</span>
              <span className="tab-label tab-label-short">{t.short}</span>
              {badge !== null && (
                <span className={`tab-badge${badge > 0 ? '' : ' tab-badge-empty'}`}>
                  {badge > 0 ? badge : 0}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="tab-content">
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
    </div>
  )
}
