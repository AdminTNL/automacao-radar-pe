import { useCallback, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import type { Instance } from './types'
import ContactsTab from './components/ContactsTab'
import SessionsTab from './components/SessionsTab'

type Tab = 'contatos' | 'sessoes'

export default function App() {
  const [instances, setInstances] = useState<Instance[]>([])
  const [instancesError, setInstancesError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('contatos')

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

  return (
    <div className="app">
      <header className="topbar">
        <h1>Botando pra Moer</h1>
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
      </nav>

      {instancesError && <div className="error">Erro: {instancesError}</div>}

      {activeTab === 'contatos' ? (
        <ContactsTab instances={instances} />
      ) : (
        <SessionsTab instances={instances} onChanged={() => void loadInstances()} />
      )}
    </div>
  )
}
