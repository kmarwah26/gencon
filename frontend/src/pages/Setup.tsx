import { useState } from 'react'
import {
  Loader2, CheckCircle2, AlertTriangle, Database, RefreshCw,
  Terminal, Copy, Check,
} from 'lucide-react'
import { api } from '../api'

function CopyBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="relative group">
      {label && <p className="text-[11px] text-[var(--text-secondary)] mb-1 font-medium">{label}</p>}
      <div className="flex items-start bg-[var(--bg-primary)] rounded-md border border-[var(--border)] overflow-hidden">
        <pre className="flex-1 p-3 text-xs font-mono text-[var(--text-primary)] overflow-x-auto whitespace-pre-wrap">{code}</pre>
        <button onClick={copy}
          className="shrink-0 p-2 m-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  )
}

export default function Setup() {
  const [cacheStatus, setCacheStatus] = useState<any>(null)
  const [cacheLoading, setCacheLoading] = useState(false)
  const [initResult, setInitResult] = useState('')
  const [syncRoomsResult, setSyncRoomsResult] = useState('')
  const [syncTablesResult, setSyncTablesResult] = useState('')
  const [actionLoading, setActionLoading] = useState('')

  const checkCache = async () => {
    setCacheLoading(true)
    try {
      const r = await api.cacheStatus()
      setCacheStatus(r)
    } catch (e: any) {
      setCacheStatus({ available: false, error: e.message })
    }
    setCacheLoading(false)
  }

  const doAction = async (action: string) => {
    setActionLoading(action)
    try {
      if (action === 'init') {
        await api.cacheInit()
        setInitResult('Cache tables created successfully')
      } else if (action === 'sync-rooms') {
        const r = await api.cacheSyncRooms()
        setSyncRoomsResult(`Synced ${r.rooms_synced} rooms`)
      } else if (action === 'sync-tables') {
        const r = await api.cacheSyncTables()
        setSyncTablesResult(`Synced ${r.tables_synced} tables`)
      }
    } catch (e: any) {
      if (action === 'init') setInitResult(`Error: ${e.message}`)
      if (action === 'sync-rooms') setSyncRoomsResult(`Error: ${e.message}`)
      if (action === 'sync-tables') setSyncTablesResult(`Error: ${e.message}`)
    }
    setActionLoading('')
  }

  return (
    <div className="max-w-3xl mx-auto p-8 pb-16">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
          <Terminal className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">Setup Guide</h2>
          <p className="text-sm text-[var(--text-secondary)]">Deploy and configure Genco on your workspace</p>
        </div>
      </div>

      <div className="space-y-8">
        {/* Step 1: Clone */}
        <section>
          <StepHeader num={1} title="Clone the repository" />
          <div className="ml-10 space-y-3">
            <CopyBlock code="git clone https://github.com/databricks/gencon.git&#10;cd gencon" />
          </div>
        </section>

        {/* Step 2: Install dependencies */}
        <section>
          <StepHeader num={2} title="Install dependencies" />
          <div className="ml-10 space-y-3">
            <CopyBlock label="Python (choose one)" code="pip install -r requirements.txt&#10;# or&#10;uv sync" />
            <CopyBlock label="Frontend (only if modifying UI)" code="cd frontend && npm install && npm run build && cd .." />
          </div>
        </section>

        {/* Step 3: Authenticate */}
        <section>
          <StepHeader num={3} title="Authenticate with Databricks" />
          <div className="ml-10 space-y-3">
            <CopyBlock code="databricks auth login --host https://<workspace-url> --profile gencon" />
            <p className="text-xs text-[var(--text-secondary)]">
              Replace <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-xs font-mono">&lt;workspace-url&gt;</code> with your Databricks workspace URL.
            </p>
          </div>
        </section>

        {/* Step 4: Run locally */}
        <section>
          <StepHeader num={4} title="Run locally" />
          <div className="ml-10 space-y-3">
            <CopyBlock code="DATABRICKS_PROFILE=gencon uvicorn app:app --reload --port 8000" />
            <p className="text-xs text-[var(--text-secondary)]">
              Open <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-xs font-mono">http://localhost:8000</code> in your browser.
            </p>
          </div>
        </section>

        {/* Step 5: Deploy */}
        <section>
          <StepHeader num={5} title="Deploy to Databricks" />
          <div className="ml-10 space-y-3">
            <CopyBlock label="Create the app" code="databricks apps create gencon --description &quot;AI/BI Genie Room Manager&quot; -p gencon" />
            <CopyBlock label="Upload source code" code={`databricks sync . /Workspace/Users/<your-email>/gencon \\
  --exclude node_modules --exclude .venv \\
  --exclude __pycache__ --exclude .git \\
  --exclude "frontend/src" --exclude "frontend/node_modules" \\
  -p gencon`} />
            <CopyBlock label="Deploy" code="databricks apps deploy gencon --source-code-path /Workspace/Users/<your-email>/gencon -p gencon" />
          </div>
        </section>

        {/* Step 6: Optional Lakebase */}
        <section>
          <StepHeader num={6} title="Optional: Configure Lakebase cache" />
          <div className="ml-10 space-y-4">
            <p className="text-sm text-[var(--text-secondary)]">
              For faster table and room loading, add a Lakebase (managed PostgreSQL) database resource to the app.
              Go to <strong>Compute &gt; Apps &gt; gencon &gt; Edit</strong> and add a Database resource named <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-xs font-mono">genco-cache-db</code>.
            </p>

            {/* Cache management */}
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
              <div className="px-4 py-3 bg-[var(--bg-tertiary)] border-b border-[var(--border)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-[#D0A33C]" />
                  <span className="text-sm font-semibold text-[var(--text-primary)]">Cache Management</span>
                </div>
                <button onClick={checkCache} disabled={cacheLoading}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[var(--bg-primary)] border border-[var(--border)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50">
                  {cacheLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Check Status
                </button>
              </div>
              <div className="p-4 space-y-3">
                {cacheStatus && (
                  <div className={`p-3 rounded-md text-sm flex items-center gap-2 ${
                    cacheStatus.available
                      ? 'bg-emerald-500/5 border border-emerald-500/20 text-emerald-600'
                      : 'bg-amber-500/5 border border-amber-500/20 text-amber-600'
                  }`}>
                    {cacheStatus.available
                      ? <><CheckCircle2 className="w-4 h-4 shrink-0" /> Connected — {cacheStatus.rooms || 0} rooms, {cacheStatus.tables || 0} tables cached</>
                      : <><AlertTriangle className="w-4 h-4 shrink-0" /> {cacheStatus.error || 'Not configured'}</>}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2">
                  <ActionButton label="Initialize Tables" loading={actionLoading === 'init'} result={initResult}
                    onClick={() => doAction('init')} />
                  <ActionButton label="Sync Rooms" loading={actionLoading === 'sync-rooms'} result={syncRoomsResult}
                    onClick={() => doAction('sync-rooms')} />
                  <ActionButton label="Sync Tables" loading={actionLoading === 'sync-tables'} result={syncTablesResult}
                    onClick={() => doAction('sync-tables')} />
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function StepHeader({ num, title }: { num: number; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="w-7 h-7 rounded-full bg-[#D0A33C] flex items-center justify-center shrink-0">
        <span className="text-xs font-bold text-white">{num}</span>
      </div>
      <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
    </div>
  )
}

function ActionButton({ label, loading, result, onClick }: {
  label: string; loading: boolean; result: string; onClick: () => void
}) {
  const isError = result.startsWith('Error')
  return (
    <div>
      <button onClick={onClick} disabled={loading}
        className="w-full px-3 py-2 rounded-md bg-[#D0A33C]/10 text-[#D0A33C] text-xs font-medium hover:bg-[#D0A33C]/20 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5">
        {loading && <Loader2 className="w-3 h-3 animate-spin" />}
        {label}
      </button>
      {result && (
        <p className={`mt-1 text-[10px] ${isError ? 'text-red-500' : 'text-emerald-600'}`}>{result}</p>
      )}
    </div>
  )
}
