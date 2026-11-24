import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import {
  ArrowDown, ArrowDownUp, ArrowUp, BarChart3, Check,
  ChevronDown, CircleUserRound, Gamepad2, Gauge, Globe, Home, LoaderCircle,
  MapPin, Moon, Network, Play, Settings, Sun, Trash2, WifiOff, X
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip,
  XAxis, YAxis
} from 'recharts'

const API = 'http://127.0.0.1:8000'
const MAX_SCALE_MBPS = 500

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

function MetricCard({ label, value, unit, kind, subtitle, fillPercent = 0, isMeasuring = false, darkMode = false }) {
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

  const hasLiquid = kind === 'download' || kind === 'upload'
  const clampedFill = Math.max(0, Math.min(100, fillPercent))

  // Paleta fiel ao projeto (#16865b para Download e #0f766e para Upload)
  const liquidTopColor = kind === 'download'
    ? (darkMode ? 'rgba(22, 134, 91, 0.34)' : 'rgba(22, 134, 91, 0.22)')
    : (darkMode ? 'rgba(15, 118, 110, 0.34)' : 'rgba(15, 118, 110, 0.22)')
  const liquidBottomColor = kind === 'download'
    ? (darkMode ? 'rgba(22, 134, 91, 0.14)' : 'rgba(22, 134, 91, 0.08)')
    : (darkMode ? 'rgba(15, 118, 110, 0.14)' : 'rgba(15, 118, 110, 0.08)')
  const waveBorderColor = kind === 'download' ? 'rgba(34, 197, 134, 0.55)' : 'rgba(20, 184, 166, 0.55)'

  return (
    <article
      className={`metric-card ${kind}`}
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderColor: isMeasuring
          ? (kind === 'download' ? '#16865b' : '#0f766e')
          : undefined,
        transition: 'border-color 0.25s ease, background-color 0.25s ease'
      }}
    >
      {hasLiquid && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: `${clampedFill}%`,
            background: `linear-gradient(180deg, ${liquidTopColor} 0%, ${liquidBottomColor} 100%)`,
            borderTop: clampedFill > 0 ? `2px solid ${waveBorderColor}` : 'none',
            transition: isMeasuring ? 'height 0.16s linear' : 'height 0.65s cubic-bezier(0.22, 1, 0.36, 1)',
            pointerEvents: 'none',
            zIndex: 0
          }}
        >
          {clampedFill > 2 && (
            <div
              className="liquid-wave-surface"
              style={{
                background: kind === 'download'
                  ? 'radial-gradient(ellipse at 50% 100%, rgba(22, 134, 91, 0.32) 0%, transparent 70%)'
                  : 'radial-gradient(ellipse at 50% 100%, rgba(15, 118, 110, 0.32) 0%, transparent 70%)'
              }}
            />
          )}
        </div>
      )}

      <div className="metric-icon" style={{ position: 'relative', zIndex: 1 }}>
        {icons[kind]}
      </div>
      <div className="metric-copy" style={{ position: 'relative', zIndex: 1 }}>
        <span className="metric-label">{label}</span>
        <div className="metric-value">
          <strong>{value ?? '—'}</strong>
          <span>{unit}</span>
        </div>
        {subtitle && <small style={{ fontSize: '0.75rem', opacity: 0.78 }}>{subtitle}</small>}
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
  const [showOfflinePopup, setShowOfflinePopup] = useState(false)

  // Tema escuro persistido no navegador
  const [darkMode, setDarkMode] = useState(() => {
    try {
      return window.localStorage.getItem('meuping_theme') === 'dark'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem('meuping_theme', darkMode ? 'dark' : 'light')
    } catch {
      // Ignora erro de storage se bloqueado
    }
    document.body.classList.toggle('dark-theme', darkMode)
  }, [darkMode])

  // Estados da animação de líquido (0 a 500 Mbps)
  const [testPhase, setTestPhase] = useState('idle') // 'idle' | 'download' | 'upload'
  const [simDownload, setSimDownload] = useState(null)
  const [simUpload, setSimUpload] = useState(null)
  const animTimerRef = useRef(null)

  const stopLiquidSimulation = useCallback(() => {
    if (animTimerRef.current) {
      window.clearInterval(animTimerRef.current)
      animTimerRef.current = null
    }
    setTestPhase('idle')
    setSimDownload(null)
    setSimUpload(null)
  }, [])

  useEffect(() => {
    return () => {
      if (animTimerRef.current) {
        window.clearInterval(animTimerRef.current)
      }
    }
  }, [])

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
    const pingInterval = window.setInterval(fetchRealtimePing, 1500)

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

  const startLiquidSimulation = () => {
    const startTime = performance.now()
    setTestPhase('download')
    setSimDownload(0)
    setSimUpload(0)

    animTimerRef.current = window.setInterval(() => {
      const elapsedSec = (performance.now() - startTime) / 1000

      if (elapsedSec <= 8.0) {
        setTestPhase('download')
        const progress = Math.min(1, elapsedSec / 8.0)
        const eased = 1 - Math.pow(1 - progress, 2.2)
        const wave = Math.sin(elapsedSec * 5) * 14 * progress
        const currentDl = Math.max(0, Math.min(MAX_SCALE_MBPS, eased * 435 + wave))
        setSimDownload(Number(currentDl.toFixed(2)))
      } else {
        setTestPhase('upload')
        const ulElapsed = elapsedSec - 8.0
        const progress = Math.min(1, ulElapsed / 7.0)
        const eased = 1 - Math.pow(1 - progress, 2.0)
        const wave = Math.sin(ulElapsed * 5.5) * 8 * progress
        const currentUl = Math.max(0, Math.min(MAX_SCALE_MBPS, eased * 195 + wave))
        setSimUpload(Number(currentUl.toFixed(2)))
      }
    }, 100)
  }

  const runTest = async () => {
    if (loading || !online) return

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError('Você está sem conexão com a internet.')
      setShowOfflinePopup(true)
      return
    }

    setLoading(true)
    setError('')
    startLiquidSimulation()

    try {
      const response = await axios.post(`${API}/api/test`, { target }, { timeout: 180000 })
      stopLiquidSimulation()
      setLatest(response.data)
      setLivePing({
        target,
        ping_ms: response.data.ping_ms,
        server_name: response.data.server_name
      })
      await loadData()
    } catch (err) {
      stopLiquidSimulation()
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

  const activeDownloadValue = loading && simDownload !== null
    ? simDownload
    : (latest?.download_mbps ?? '—')

  const activeUploadValue = loading && simUpload !== null
    ? simUpload
    : (latest?.upload_mbps ?? '—')

  const downloadFillPercent = typeof activeDownloadValue === 'number'
    ? (activeDownloadValue / MAX_SCALE_MBPS) * 100
    : 0

  const uploadFillPercent = typeof activeUploadValue === 'number'
    ? (activeUploadValue / MAX_SCALE_MBPS) * 100
    : 0

  const buttonLabel = !loading
    ? 'Iniciar teste'
    : testPhase === 'upload'
      ? 'Medindo upload...'
      : 'Medindo download...'

  return (
    <div className={`app-shell ${darkMode ? 'dark-theme' : ''}`}>
      <style>{`
        @keyframes liquidWaveFloat {
          0%, 100% { transform: translateX(-8%) scaleY(1); }
          50% { transform: translateX(8%) scaleY(1.35); }
        }
        .liquid-wave-surface {
          position: absolute;
          top: -6px;
          left: -10%;
          right: -10%;
          height: 10px;
          animation: liquidWaveFloat 2.2s ease-in-out infinite;
          pointer-events: none;
        }

        .theme-toggle-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border-radius: 10px;
          border: 1px solid #d2e4d8;
          background: #f3f8f5;
          color: #2f4f42;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .theme-toggle-btn:hover {
          background: #e4f0e9;
          color: #16865b;
        }

        /* Paleta Tema Escuro */
        body.dark-theme,
        .app-shell.dark-theme {
          background-color: #0b1310;
          color: #e6f0ec;
        }
        .app-shell.dark-theme .topbar {
          background-color: #101b17;
          border-bottom-color: #1e3028;
        }
        .app-shell.dark-theme .brand {
          color: #eef6f2;
        }
        .app-shell.dark-theme .nav-item {
          color: #9bb3a8;
        }
        .app-shell.dark-theme .nav-item:hover {
          background-color: #162620;
          color: #e6f0ec;
        }
        .app-shell.dark-theme .nav-item.active {
          background-color: #173026;
          color: #34d399;
        }
        .app-shell.dark-theme .theme-toggle-btn {
          background: #162620;
          border-color: #263d33;
          color: #fbbf24;
        }
        .app-shell.dark-theme .theme-toggle-btn:hover {
          background: #1d322a;
        }
        .app-shell.dark-theme .online-status {
          background-color: #132820;
          border-color: #1f4234;
          color: #34d399;
        }
        .app-shell.dark-theme .online-status.offline {
          background-color: #2a1517;
          border-color: #4c2226;
          color: #f87171;
        }
        .app-shell.dark-theme .page-heading h1 {
          color: #f0f7f4;
        }
        .app-shell.dark-theme .page-heading p {
          color: #93aba0;
        }
        .app-shell.dark-theme .metric-card,
        .app-shell.dark-theme .quality-panel,
        .app-shell.dark-theme .chart-panel,
        .app-shell.dark-theme .history-table-wrap,
        .app-shell.dark-theme .placeholder-card {
          background-color: #121e19;
          border-color: #1f322a;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
        }
        .app-shell.dark-theme .metric-label,
        .app-shell.dark-theme .quality-label,
        .app-shell.dark-theme .chart-foot,
        .app-shell.dark-theme .legend,
        .app-shell.dark-theme .empty-chart span,
        .app-shell.dark-theme .placeholder-card span {
          color: #8ea79c;
        }
        .app-shell.dark-theme .metric-value strong,
        .app-shell.dark-theme .chart-title h2,
        .app-shell.dark-theme .empty-chart strong,
        .app-shell.dark-theme .placeholder-card strong {
          color: #f0f7f4;
        }
        .app-shell.dark-theme .metric-value span {
          color: #8ea79c;
        }
        .app-shell.dark-theme .metric-icon,
        .app-shell.dark-theme .quality-icon,
        .app-shell.dark-theme .empty-icon {
          background-color: #182b23;
          color: #34d399;
        }
        .app-shell.dark-theme .quality-panel small {
          color: #93aba0;
        }
        .app-shell.dark-theme .chart-tooltip {
          background-color: #162620;
          border-color: #284237;
          color: #e6f0ec;
        }
        .app-shell.dark-theme .history-table-wrap th {
          background-color: #162620;
          color: #a9c0b6;
          border-bottom-color: #243930;
        }
        .app-shell.dark-theme .history-table-wrap td {
          color: #dce9e3;
          border-bottom-color: #1c2e26;
        }
        .app-shell.dark-theme .history-table-wrap tr:hover td {
          background-color: #16251f;
        }
        .app-shell.dark-theme .footer {
          color: #7c968b;
          border-top-color: #1c2e26;
        }
        .app-shell.dark-theme .error-banner {
          background-color: #2b1417;
          border-color: #5c2328;
          color: #fca5a5;
        }
      `}</style>

      <header className="topbar">
        <button className="brand" onClick={() => setPage('Dashboard')} aria-label="Ir para dashboard">
          <span className="brand-mark"><Network size={29} strokeWidth={2.2} /></span>
          <span>Meu <span>Ping</span></span>
        </button>

        <nav className="main-nav" aria-label="Navegação principal">
          <button className={page === 'Dashboard' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('Dashboard')}>
            <Home size={18} /> Início
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
          <button
            type="button"
            className="theme-toggle-btn"
            onClick={() => setDarkMode((prev) => !prev)}
            aria-label={darkMode ? 'Ativar tema claro' : 'Ativar tema escuro'}
            title={darkMode ? 'Tema claro' : 'Tema escuro'}
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <span className={`online-status ${online ? '' : 'offline'}`}>
            <i /> {online ? 'Online' : 'Offline'}
          </span>

          { /*BOTAO DE PERFIL REMOVIDO DEIXE COMENTADO PARA FUTURAS IMPLEMENTAÇÕES*/
            
          /*<button className="profile-button" aria-label="Perfil"><CircleUserRound size={27} /><ChevronDown size={14} /></button>*/}
         
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
                    background: darkMode ? '#162620' : '#e9f2ec',
                    padding: '4px',
                    borderRadius: '10px',
                    border: darkMode ? '1px solid #263d33' : '1px solid #d2e4d8',
                    transition: 'background-color 0.25s ease, border-color 0.25s ease'
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
                      background: target === 'local'
                        ? (darkMode ? '#22382f' : '#ffffff')
                        : 'transparent',
                      color: target === 'local'
                        ? (darkMode ? '#34d399' : '#16865b')
                        : (darkMode ? '#93aba0' : '#4b6358'),
                      boxShadow: target === 'local' ? '0 1px 3px rgba(0,0,0,0.12)' : 'none'
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
                      background: target === 'sp'
                        ? (darkMode ? '#22382f' : '#ffffff')
                        : 'transparent',
                      color: target === 'sp'
                        ? (darkMode ? '#34d399' : '#16865b')
                        : (darkMode ? '#93aba0' : '#4b6358'),
                      boxShadow: target === 'sp' ? '0 1px 3px rgba(0,0,0,0.12)' : 'none'
                    }}
                  >
                    <Globe size={15} /> São Paulo
                  </button>
                </div>

                <button
                  type="button"
                  className="test-button"
                  onClick={runTest}
                  disabled={loading || !online}
                >
                  {loading ? (
                    <LoaderCircle className="spin" size={19} />
                  ) : (
                    <Play size={18} fill="currentColor" />
                  )}
                  {buttonLabel}
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
                darkMode={darkMode}
              />
              <MetricCard
                label="DOWNLOAD"
                value={activeDownloadValue}
                unit="Mbps"
                kind="download"
                fillPercent={downloadFillPercent}
                isMeasuring={loading && testPhase === 'download'}
                darkMode={darkMode}
              />
              <MetricCard
                label="UPLOAD"
                value={activeUploadValue}
                unit="Mbps"
                kind="upload"
                fillPercent={uploadFillPercent}
                isMeasuring={loading && testPhase === 'upload'}
                darkMode={darkMode}
              />
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
                          <stop offset="0%" stopColor="#16865b" stopOpacity={darkMode ? 0.32 : 0.17} />
                          <stop offset="100%" stopColor="#16865b" stopOpacity={0.01} />
                        </linearGradient>
                        <linearGradient id="uploadFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#0f766e" stopOpacity={darkMode ? 0.28 : 0.14} />
                          <stop offset="100%" stopColor="#0f766e" stopOpacity={0.01} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={darkMode ? '#1e3028' : '#e2ebe5'} vertical={true} />
                      <XAxis
                        dataKey="time"
                        tick={{ fill: darkMode ? '#8ea79c' : '#71877d', fontSize: 12 }}
                        axisLine={{ stroke: darkMode ? '#243930' : '#dce8df' }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: darkMode ? '#8ea79c' : '#71877d', fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                        unit=" Mbps"
                        width={75}
                      />
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
                  border: darkMode ? '1px solid #5c2328' : '1px solid #fecaca',
                  background: !history.length || clearing || !online
                    ? (darkMode ? '#162620' : '#f8fafc')
                    : (darkMode ? '#2b1417' : '#fef2f2'),
                  color: !history.length || clearing || !online
                    ? (darkMode ? '#526b60' : '#94a3b8')
                    : (darkMode ? '#fca5a5' : '#dc2626'),
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
                    <th>Servidor</th>
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

      {showOfflinePopup && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="offline-modal-title"
          onClick={() => setShowOfflinePopup(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(5, 10, 8, 0.65)',
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
              background: darkMode ? '#121e19' : '#ffffff',
              borderRadius: '16px',
              padding: '24px',
              maxWidth: '400px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.35)',
              border: darkMode ? '1px solid #5c2328' : '1px solid #fecaca'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: darkMode ? '#f87171' : '#dc2626' }}>
                <WifiOff size={22} />
                <h3 id="offline-modal-title" style={{ margin: 0, fontSize: '1.05rem', color: darkMode ? '#f0f7f4' : '#0f172a' }}>
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
                  color: darkMode ? '#8ea79c' : '#64748b',
                  padding: '4px'
                }}
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ margin: '0 0 20px', fontSize: '0.93rem', lineHeight: 1.5, color: darkMode ? '#a9c0b6' : '#475569' }}>
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