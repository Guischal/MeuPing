import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import {
  ArrowDown, ArrowDownUp, ArrowUp, BarChart3, Check,
  ChevronDown, CircleUserRound, Gamepad2, Gauge, Globe, Home, Info, LoaderCircle,
  Lock, MapPin, Network, Play, Settings, Trash2, WifiOff, X
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip,
  XAxis, YAxis
} from 'recharts'

const API = 'http://127.0.0.1:8000'

function formatTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function getPingColor(ping) {
  if (ping === null || ping === undefined || Number.isNaN(ping)) {
    return 'rgb(148, 163, 184)'
  }
  const green = { r: 34, g: 197, b: 94 }
  const red = { r: 239, g: 68, b: 68 }

  const progress = Math.max(0, Math.min(1, (ping - 30) / 150))

  const r = Math.round(green.r + (red.r - green.r) * progress)
  const g = Math.round(green.g + (red.g - green.g) * progress)
  const b = Math.round(green.b + (red.b - green.b) * progress)

  return `rgb(${r}, ${g}, ${b})`
}

function MetricCard({ label, value, unit, kind, subtitle }) {
  const icons = {
    ping: (
      <div
        className="ping-sphere"
        style={{
          '--sphere-color': getPingColor(Number(value))
        }}
      />
    ),
    download: <ArrowDown size={27} strokeWidth={2.8} />,
    upload: <ArrowUp size={27} strokeWidth={2.8} />
  }

  return (
    <article className={`metric-card ${kind}`}>
      <div className="metric-icon">{icons[kind]}</div>
      <div className="metric-copy">
        <span className="metric-label">{label}</span>
        <div className="metric-value">
          <strong>{value ?? '—'}</strong>
          <span>{unit}</span>
        </div>
        {subtitle && <small style={{ fontSize: '0.75rem', opacity: 0.75 }}>{subtitle}</small>}
      </div>
    </article>
  )
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {payload.map((item) => (
        <div key={item.dataKey} style={{ color: item.color }}>
          {item.name}: {Number(item.value).toFixed(2)} Mbps
        </div>
      ))}
    </div>
  )
}

export default function App() {
  const [page, setPage] = useState('Dashboard')
  const [history, setHistory] = useState([])
  const [online, setOnline] = useState(false)
  const [loading, setLoading] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState('')
  const [latest, setLatest] = useState(null)

  const [target, setTarget] = useState('local')
  const [livePing, setLivePing] = useState(null)
  const [showSpPopup, setShowSpPopup] = useState(false)
  const [showOfflinePopup, setShowOfflinePopup] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const [health, measurements] = await Promise.all([
        axios.get(`${API}/api/health`, { timeout: 3000 }),
        axios.get(`${API}/api/history?limit=30`, { timeout: 5000 })
      ])
      setOnline(health.data.status === 'online')
      setHistory(measurements.data)
      if (measurements.data.length) {
        setLatest(measurements.data[measurements.data.length - 1])
      } else {
        setLatest(null)
      }
    } catch {
      setOnline(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    const timer = window.setInterval(loadData, 10000)
    return () => window.clearInterval(timer)
  }, [loadData])

  useEffect(() => {
    if (!online || loading) return

    let cancelled = false

    const fetchRealtimePing = async () => {
      try {
        const response = await axios.get(`${API}/api/ping`, {
          params: { target },
          timeout: 8000
        })
        if (!cancelled && response.data?.target === target) {
          setLivePing(response.data)
        }
      } catch {
        // Mantém a última leitura válida sem sobrescrever com o outro destino
      }
    }

    fetchRealtimePing()
    const pingInterval = window.setInterval(fetchRealtimePing, 1000)

    return () => {
      cancelled = true
      window.clearInterval(pingInterval)
    }
  }, [online, loading, target])

  const handleTargetChange = (newTarget) => {
    if (newTarget === target || loading) return
    setTarget(newTarget)
    setLivePing(null)
    setError('')
  }

  const runTest = async () => {
    if (target === 'sp') {
      setShowSpPopup(true)
      return
    }

    if (loading || !online) return

    // Verificação imediata no navegador antes mesmo de acionar o backend
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError('Você está sem conexão com a internet.')
      setShowOfflinePopup(true)
      return
    }

    setLoading(true)
    setError('')
    try {
      const response = await axios.post(`${API}/api/test`, { target: 'local' }, { timeout: 180000 })
      setLatest(response.data)
      setLivePing({
        target: 'local',
        ping_ms: response.data.ping_ms,
        server_name: response.data.server_name
      })
      await loadData()
    } catch (err) {
      const status = err.response?.status
      const message =
        err.response?.data?.detail ||
        'Não foi possível realizar o teste. Verifique se o backend está em execução e tente novamente.'

      if (status === 503 || message.toLowerCase().includes('sem conexão com a internet')) {
        setError('Você está sem conexão com a internet. Verifique seu Wi-Fi ou cabo de rede.')
        setShowOfflinePopup(true)
      } else {
        setError(message)
      }
    } finally {
      setLoading(false)
    }
  }

  const clearHistory = async () => {
    if (!history.length || clearing) return
    const confirmed = window.confirm('Tem certeza que deseja excluir todo o histórico de medições? O gráfico também será zerado.')
    if (!confirmed) return

    setClearing(true)
    setError('')
    try {
      await axios.delete(`${API}/api/history`, { timeout: 5000 })
      setHistory([])
      setLatest(null)
    } catch (err) {
      const message =
        err.response?.data?.detail ||
        'Não foi possível excluir o histórico. Verifique se o backend está ativo.'
      setError(message)
    } finally {
      setClearing(false)
    }
  }

  const chartData = useMemo(
    () =>
      history.map((item) => ({
        time: formatTime(item.created_at),
        download: Number(item.download_mbps),
        upload: Number(item.upload_mbps)
      })),
    [history]
  )

  const quality = latest?.quality || null
  const displayedPing = livePing?.target === target
    ? livePing.ping_ms
    : (latest?.target_mode === target ? latest.ping_ms : '...')

  const pingSubtitle = livePing?.target === target && livePing?.server_name
    ? `Tempo real · ${livePing.server_name}`
    : target === 'sp'
      ? 'Buscando servidor em São Paulo...'
      : 'Buscando roteador local...'

  const isSpUnavailable = target === 'sp'

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setPage('Dashboard')} aria-label="Ir para dashboard">
          <span className="brand-mark"><Network size={29} strokeWidth={2.2} /></span>
          <span>Meu <span>Ping</span></span>
        </button>

        <nav className="main-nav" aria-label="Navegação principal">
          <button className={page === 'Dashboard' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('Dashboard')}>
            <Home size={18} /> Dashboard
          </button>
          <button className={page === 'Histórico' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('Histórico')}>
            <BarChart3 size={18} /> Histórico
          </button>
          <button className={page === 'Jogos' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('Jogos')}>
            <Gamepad2 size={19} /> Jogos
          </button>
          <button className={page === 'Configurações' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('Configurações')}>
            <Settings size={18} /> Configurações
          </button>
        </nav>

        <div className="topbar-right">
          <span className={`online-status ${online ? '' : 'offline'}`}>
            <i /> {online ? 'Online' : 'Offline'}
          </span>
          <button className="profile-button" aria-label="Perfil"><CircleUserRound size={27} /><ChevronDown size={14} /></button>
        </div>
      </header>

      <main className="main-content">
        {page === 'Dashboard' ? (
          <>
            <section className="page-heading">
              <div>
                <h1>Visão geral</h1>
                <p>Acompanhe o desempenho da sua rede e a latência em tempo real.</p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div
                  role="group"
                  aria-label="Selecionar servidor de teste"
                  style={{
                    display: 'inline-flex',
                    background: '#e9f2ec',
                    padding: '4px',
                    borderRadius: '10px',
                    border: '1px solid #d2e4d8'
                  }}
                >
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => handleTargetChange('local')}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      background: target === 'local' ? '#ffffff' : 'transparent',
                      color: target === 'local' ? '#16865b' : '#4b6358',
                      boxShadow: target === 'local' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
                    }}
                  >
                    <MapPin size={15} /> Local
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => handleTargetChange('sp')}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      background: target === 'sp' ? '#ffffff' : 'transparent',
                      color: target === 'sp' ? '#16865b' : '#4b6358',
                      boxShadow: target === 'sp' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
                    }}
                  >
                    <Globe size={15} /> São Paulo
                  </button>
                </div>

                <button
                  type="button"
                  className="test-button"
                  onClick={runTest}
                  disabled={!isSpUnavailable && (loading || !online)}
                  aria-disabled={isSpUnavailable}
                  style={
                    isSpUnavailable
                      ? {
                          background: '#cbd5e1',
                          color: '#475569',
                          cursor: 'not-allowed',
                          boxShadow: 'none',
                          opacity: 0.85
                        }
                      : undefined
                  }
                >
                  {loading ? (
                    <LoaderCircle className="spin" size={19} />
                  ) : isSpUnavailable ? (
                    <Lock size={17} />
                  ) : (
                    <Play size={18} fill="currentColor" />
                  )}
                  {loading ? 'Testando conexão...' : 'Iniciar teste'}
                </button>
              </div>
            </section>

            {error && <div className="error-banner">{error}</div>}

            <section className="metrics-row" aria-label="Métricas da conexão">
              <MetricCard
                label="PING (TEMPO REAL)"
                value={displayedPing}
                unit="ms"
                kind="ping"
                subtitle={pingSubtitle}
              />
              <MetricCard label="DOWNLOAD" value={latest?.download_mbps ?? '—'} unit="Mbps" kind="download" />
              <MetricCard label="UPLOAD" value={latest?.upload_mbps ?? '—'} unit="Mbps" kind="upload" />
              <div className="quality-panel">
                <div className="quality-icon"><Check size={29} strokeWidth={3} /></div>
                <div>
                  <span className="quality-label">Qualidade da conexão</span>
                  <strong className={quality ? `quality-${quality.label.toLowerCase()}` : ''}>{quality?.label || 'Aguardando teste'}</strong>
                  <small>{quality?.description || 'Execute um teste para avaliar sua rede.'}</small>
                </div>
              </div>
            </section>

            <section className="chart-panel">
              <div className="chart-header">
                <div className="chart-title">
                  <ArrowDownUp size={23} />
                  <h2>Velocidade de conexão</h2>
                </div>
                <div className="legend">
                  <span><i className="legend-dot download-dot" />Download {latest ? `· ${latest.download_mbps} Mbps` : ''}</span>
                  <span><i className="legend-dot upload-dot" />Upload {latest ? `· ${latest.upload_mbps} Mbps` : ''}</span>
                </div>
              </div>

              {chartData.length ? (
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 12, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="downloadFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#16865b" stopOpacity={0.17} />
                          <stop offset="100%" stopColor="#16865b" stopOpacity={0.01} />
                        </linearGradient>
                        <linearGradient id="uploadFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#0f766e" stopOpacity={0.14} />
                          <stop offset="100%" stopColor="#0f766e" stopOpacity={0.01} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#e2ebe5" vertical={true} />
                      <XAxis dataKey="time" tick={{ fill: '#71877d', fontSize: 12 }} axisLine={{ stroke: '#dce8df' }} tickLine={false} />
                      <YAxis tick={{ fill: '#71877d', fontSize: 12 }} axisLine={false} tickLine={false} unit=" Mbps" width={75} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area type="monotone" dataKey="download" name="Download" stroke="#16865b" strokeWidth={3} fill="url(#downloadFill)" dot={{ r: 4, fill: '#16865b', strokeWidth: 0 }} activeDot={{ r: 6 }} />
                      <Area type="monotone" dataKey="upload" name="Upload" stroke="#0f766e" strokeWidth={3} fill="url(#uploadFill)" dot={{ r: 4, fill: '#0f766e', strokeWidth: 0 }} activeDot={{ r: 6 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="empty-chart">
                  <div className="empty-icon"><Gauge size={30} /></div>
                  <strong>Nenhuma medição registrada</strong>
                  <span>Inicie um teste para preencher o gráfico com dados reais.</span>
                </div>
              )}
              <div className="chart-foot">
                <span>{history.length} {history.length === 1 ? 'medição registrada' : 'medições registradas'}</span>
                {latest && (
                  <span>
                    Último teste ({latest.target_mode === 'sp' ? 'São Paulo' : 'Local'}): {formatTime(latest.created_at)} · {latest.server_name}
                  </span>
                )}
              </div>
            </section>
          </>
        ) : page === 'Histórico' ? (
          <section className="secondary-page">
            <div className="page-heading">
              <div>
                <h1>Histórico</h1>
                <p>Consulte os resultados das medições realizadas.</p>
              </div>
              <button
                type="button"
                onClick={clearHistory}
                disabled={!history.length || clearing || !online}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 16px',
                  borderRadius: '10px',
                  border: '1px solid #fecaca',
                  background: !history.length || clearing || !online ? '#f8fafc' : '#fef2f2',
                  color: !history.length || clearing || !online ? '#94a3b8' : '#dc2626',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  cursor: !history.length || clearing || !online ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {clearing ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}
                {clearing ? 'Excluindo...' : 'Excluir histórico'}
              </button>
            </div>

            {error && <div className="error-banner">{error}</div>}

            <div className="history-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Data e hora</th>
                    <th>Destino</th>
                    <th>Ping</th>
                    <th>Download</th>
                    <th>Upload</th>
                    <th>Qualidade</th>
                  </tr>
                </thead>
                <tbody>
                  {[...history].reverse().map((item) => (
                    <tr key={item.id}>
                      <td>{new Date(item.created_at).toLocaleString('pt-BR')}</td>
                      <td>{item.target_mode === 'sp' ? 'São Paulo' : 'Local'}</td>
                      <td>{item.ping_ms} ms</td>
                      <td>{item.download_mbps} Mbps</td>
                      <td>{item.upload_mbps} Mbps</td>
                      <td>{item.quality.label}</td>
                    </tr>
                  ))}
                  {!history.length && <tr><td colSpan="6" className="empty-row">Ainda não existem medições salvas.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className="secondary-page">
            <div className="page-heading"><div><h1>{page}</h1><p>{page === 'Jogos' ? 'Área reservada para futuras medições por jogo e região.' : 'Preferências e informações do Meu Ping.'}</p></div></div>
            <div className="placeholder-card">
              {page === 'Jogos' ? <Gamepad2 size={30} /> : <Settings size={30} />}
              <strong>{page === 'Jogos' ? 'Módulo planejado' : 'Configurações em desenvolvimento'}</strong>
              <span>{page === 'Jogos' ? 'Esta seção poderá consultar ping, jitter e disponibilidade de servidores de jogos.' : 'As opções de configuração serão adicionadas em uma próxima etapa.'}</span>
            </div>
          </section>
        )}
      </main>

      {showSpPopup && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sp-modal-title"
          onClick={() => setShowSpPopup(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            zIndex: 1000
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              padding: '24px',
              maxWidth: '400px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.15)',
              border: '1px solid #e2e8f0'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#0f766e' }}>
                <Info size={22} />
                <h3 id="sp-modal-title" style={{ margin: 0, fontSize: '1.05rem', color: '#0f172a' }}>
                  Função indisponível
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSpPopup(false)}
                aria-label="Fechar aviso"
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#64748b',
                  padding: '4px'
                }}
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ margin: '0 0 20px', fontSize: '0.93rem', lineHeight: 1.5, color: '#475569' }}>
              O teste completo de download e upload no servidor de <strong>São Paulo</strong> ainda não está disponível nesta versão. Por enquanto, você pode acompanhar o <strong>Ping em tempo real</strong> para São Paulo ou alternar para <strong>Local</strong> para executar o teste completo.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => {
                  setShowSpPopup(false)
                  handleTargetChange('local')
                }}
                style={{
                  padding: '9px 14px',
                  borderRadius: '9px',
                  border: '1px solid #cbd5e1',
                  background: '#f8fafc',
                  color: '#334155',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer'
                }}
              >
                Mudar para Local
              </button>
              <button
                type="button"
                onClick={() => setShowSpPopup(false)}
                style={{
                  padding: '9px 16px',
                  borderRadius: '9px',
                  border: 'none',
                  background: '#16865b',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer'
                }}
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}

      {showOfflinePopup && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="offline-modal-title"
          onClick={() => setShowOfflinePopup(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            zIndex: 1000
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              padding: '24px',
              maxWidth: '400px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.15)',
              border: '1px solid #fecaca'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#dc2626' }}>
                <WifiOff size={22} />
                <h3 id="offline-modal-title" style={{ margin: 0, fontSize: '1.05rem', color: '#0f172a' }}>
                  Sem conexão com a internet
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowOfflinePopup(false)}
                aria-label="Fechar aviso"
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#64748b',
                  padding: '4px'
                }}
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ margin: '0 0 20px', fontSize: '0.93rem', lineHeight: 1.5, color: '#475569' }}>
              Não foi possível detectar acesso externo à internet no momento. Mesmo que seu roteador local esteja ligado, a conexão externa está indisponível. Verifique seu cabo de rede ou Wi-Fi e tente novamente.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowOfflinePopup(false)}
                style={{
                  padding: '9px 18px',
                  borderRadius: '9px',
                  border: 'none',
                  background: '#dc2626',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer'
                }}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="footer">Meu Ping <span>·</span> Sua conexão, em detalhes.</footer>
    </div>
  )
}