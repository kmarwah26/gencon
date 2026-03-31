import { useState, useEffect } from 'react'
import {
  Loader2, CheckCircle2, XCircle, AlertTriangle,
  Database, Warehouse, MessageSquare, Cpu, Server, Layers,
} from 'lucide-react'
import { api } from '../api'
import type { ServiceStatus } from '../api'

const typeIcons: Record<string, typeof Database> = {
  workspace: Server,
  catalog: Layers,
  warehouse: Warehouse,
  genie: MessageSquare,
  database: Database,
  llm: Cpu,
}

const statusColors: Record<string, { bg: string; border: string; icon: typeof CheckCircle2; iconColor: string }> = {
  connected: { bg: 'bg-emerald-500/5', border: 'border-emerald-500/20', icon: CheckCircle2, iconColor: 'text-emerald-500' },
  error: { bg: 'bg-red-500/5', border: 'border-red-500/20', icon: XCircle, iconColor: 'text-red-500' },
  unavailable: { bg: 'bg-amber-500/5', border: 'border-amber-500/20', icon: AlertTriangle, iconColor: 'text-amber-500' },
}

export default function Services() {
  const [services, setServices] = useState<ServiceStatus[]>([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    api.getServices()
      .then((r) => setServices(r.services))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const connected = services.filter((s) => s.status === 'connected').length
  const total = services.length

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-sky-500 to-cyan-600 flex items-center justify-center">
            <Server className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-[var(--text-primary)]">Connected Services</h2>
            <p className="text-sm text-[var(--text-secondary)]">Databricks workspace integrations</p>
          </div>
        </div>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)] transition-colors disabled:opacity-50 flex items-center gap-1.5">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
          Refresh
        </button>
      </div>

      {loading && services.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-[var(--text-secondary)]">
          <Loader2 className="w-8 h-8 animate-spin mb-3" />
          <p className="text-sm">Checking service connections...</p>
        </div>
      ) : (
        <>
          {/* Summary bar */}
          <div className="mb-6 p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${connected === total ? 'bg-emerald-500' : connected > 0 ? 'bg-amber-500' : 'bg-red-500'}`} />
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {connected}/{total} services connected
              </span>
            </div>
            <div className="flex-1 h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${connected === total ? 'bg-emerald-500' : 'bg-amber-500'}`}
                style={{ width: `${total ? (connected / total) * 100 : 0}%` }}
              />
            </div>
          </div>

          {/* Service cards */}
          <div className="space-y-3">
            {services.map((svc) => {
              const style = statusColors[svc.status] || statusColors.error
              const Icon = typeIcons[svc.type] || Server
              const StatusIcon = style.icon

              return (
                <div key={svc.name} className={`rounded-lg border ${style.border} ${style.bg} overflow-hidden`}>
                  <div className="flex items-center gap-4 px-5 py-4">
                    <div className="w-10 h-10 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5 text-[var(--text-secondary)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{svc.name}</h3>
                        <StatusIcon className={`w-4 h-4 ${style.iconColor}`} />
                      </div>
                      {svc.error && (
                        <p className="text-xs text-red-400 mt-0.5 truncate">{svc.error}</p>
                      )}
                      {svc.status === 'unavailable' && svc.details?.reason && (
                        <p className="text-xs text-amber-600 mt-0.5">{svc.details.reason}</p>
                      )}
                    </div>
                    <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      svc.status === 'connected' ? 'bg-emerald-500/10 text-emerald-600'
                        : svc.status === 'error' ? 'bg-red-500/10 text-red-500'
                          : 'bg-amber-500/10 text-amber-600'
                    }`}>
                      {svc.status}
                    </span>
                  </div>

                  {/* Details */}
                  {svc.details && Object.keys(svc.details).length > 0 && (
                    <div className="px-5 pb-4 pt-0">
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                        {Object.entries(svc.details).map(([key, value]) => {
                          if ((key === 'models_sample' || key === 'models') && Array.isArray(value)) {
                            return value.length > 0 ? (
                              <div key={key} className="col-span-2">
                                <span className="text-[11px] text-[var(--text-secondary)]">Models: </span>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {value.map((m: string) => (
                                    <span key={m} className="inline-block px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[10px] font-mono text-[var(--text-primary)]">{m}</span>
                                  ))}
                                </div>
                              </div>
                            ) : null
                          }
                          return (
                            <div key={key} className="flex items-baseline gap-1.5">
                              <span className="text-[11px] text-[var(--text-secondary)] capitalize">{key.replace(/_/g, ' ')}:</span>
                              <span className="text-[11px] text-[var(--text-primary)] font-medium truncate">
                                {typeof value === 'number' ? value.toLocaleString() : String(value)}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
