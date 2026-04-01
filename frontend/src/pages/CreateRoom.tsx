import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, X, Loader2, Sparkles, Warehouse, Search,
  ChevronRight, ChevronDown, Database, Layers, Table2, Check,
  AlertTriangle, CheckCircle2, FileText, BarChart3, ArrowRight, ArrowLeft,
  Pencil, Save, Code, Trash2, Wand2, Clock, Hash, MessageSquarePlus, SkipForward,
  Upload, FolderOpen, Folder,
} from 'lucide-react'
import { api } from '../api'
import type {
  Warehouse as WarehouseType, Catalog, Schema, Table,
  CatalogSearchResult, DescriptionValidation,
  SummaryStatsResult, TimeRangesResult, WorkspaceItem,
} from '../api'
import { useAppStore } from '../store'

const STEPS = [
  { num: 1, label: 'Setup', icon: Database },
  { num: 2, label: 'Descriptions', icon: FileText },
  { num: 3, label: 'Analysis', icon: BarChart3, optional: true },
  { num: 4, label: 'SQL Instructions', icon: Code },
  { num: 5, label: 'Create', icon: Sparkles },
]

interface SampleQuery {
  question: string
  sql: string
}

export default function CreateRoom() {
  const { selectedTables, toggleTable, removeTable, clearTables } = useAppStore()
  const [step, setStep] = useState(1)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [warehouses, setWarehouses] = useState<WarehouseType[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  // Step 2
  const [descValidation, setDescValidation] = useState<DescriptionValidation | null>(null)
  const [validating, setValidating] = useState(false)
  const [generatingDesc, setGeneratingDesc] = useState(false)

  // Step 3 — optional analysis
  const [statsResult, setStatsResult] = useState<SummaryStatsResult | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [timeResult, setTimeResult] = useState<TimeRangesResult | null>(null)
  const [timeLoading, setTimeLoading] = useState(false)
  const [datasetDesc, setDatasetDesc] = useState('')
  const [datasetDescLoading, setDatasetDescLoading] = useState(false)

  // Step 4 - SQL Instructions
  const [sampleQueries, setSampleQueries] = useState<SampleQuery[]>([])
  const [instructions, setInstructions] = useState('')

  // Picker state
  const [pickerOpen, setPickerOpen] = useState(false)
  const [catalogs, setCatalogs] = useState<Catalog[]>([])
  const [catalogsLoading, setCatalogsLoading] = useState(false)
  const [expandedCatalogs, setExpandedCatalogs] = useState<Set<string>>(new Set())
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set())
  const [schemas, setSchemas] = useState<Record<string, Schema[]>>({})
  const [tables, setTables] = useState<Record<string, Table[]>>({})
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set())
  const [pickerSearch, setPickerSearch] = useState('')
  const [searchResults, setSearchResults] = useState<CatalogSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    const q = pickerSearch.trim()
    if (!q || q.length < 2) { setSearchResults([]); setSearching(false); return }

    setSearching(true)
    searchTimer.current = setTimeout(() => {
      api.searchCatalog(q)
        .then((r) => { setSearchResults(r.results); setSearching(false) })
        .catch(() => { setSearchResults([]); setSearching(false) })
    }, 300)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [pickerSearch])

  useEffect(() => {
    api.listWarehouses().then((r) => {
      setWarehouses(r.warehouses)
      const running = r.warehouses.find((w) => w.state.includes('RUNNING'))
      if (running) setWarehouseId(running.id)
    }).catch(() => {})
  }, [])

  const openPicker = useCallback(() => {
    setPickerOpen(true)
    if (catalogs.length === 0) {
      setCatalogsLoading(true)
      api.listCatalogs().then((r) => { setCatalogs(r.catalogs); setCatalogsLoading(false) })
        .catch(() => setCatalogsLoading(false))
    }
  }, [catalogs.length])

  const toggleCatalog = async (name: string) => {
    if (expandedCatalogs.has(name)) {
      setExpandedCatalogs((s) => { const n = new Set(s); n.delete(name); return n })
    } else {
      setExpandedCatalogs((s) => new Set(s).add(name))
      if (!schemas[name]) {
        setLoadingNodes((s) => new Set(s).add(name))
        try { const r = await api.listSchemas(name); setSchemas((s) => ({ ...s, [name]: r.schemas })) } catch {}
        setLoadingNodes((s) => { const n = new Set(s); n.delete(name); return n })
      }
    }
  }

  const toggleSchema = async (catalog: string, schema: string) => {
    const key = `${catalog}.${schema}`
    if (expandedSchemas.has(key)) {
      setExpandedSchemas((s) => { const n = new Set(s); n.delete(key); return n })
    } else {
      setExpandedSchemas((s) => new Set(s).add(key))
      if (!tables[key]) {
        setLoadingNodes((s) => new Set(s).add(key))
        try { const r = await api.listTables(catalog, schema); setTables((s) => ({ ...s, [key]: r.tables })) } catch {}
        setLoadingNodes((s) => { const n = new Set(s); n.delete(key); return n })
      }
    }
  }

  const canProceedStep1 = title.trim().length > 0 && selectedTables.length > 0

  const goToStep = async (target: number) => {
    setError('')
    if (target === 2 && step === 1) {
      if (!canProceedStep1) { setError('Please enter a room name and select at least one table'); return }
      setStep(2)
      if (!descValidation) {
        setValidating(true)
        try { const r = await api.validateDescriptions(selectedTables); setDescValidation(r) } catch (e: any) { setError(e.message) }
        setValidating(false)
      }
    } else if (target === 3 && step === 2) {
      setStep(3)
      // Don't auto-run analysis — step 3 is optional and on-demand
    } else if (target === 4 && (step === 2 || step === 3)) {
      // Allow skipping analysis (step 3) from step 2
      setStep(4)
    } else if (target === 5 && step === 4) {
      setStep(5)
    } else if (target < step) {
      setStep(target)
    }
  }

  const handleCreate = async () => {
    setCreating(true); setError('')
    try {
      // Filter out empty sample queries before sending
      const validQueries = sampleQueries.filter(sq => sq.question.trim() || sq.sql.trim())
      const result = await api.createGenieRoom({
        title: title.trim(),
        description: description.trim(),
        table_identifiers: selectedTables,
        warehouse_id: warehouseId || undefined,
        sample_queries: validQueries.length > 0 ? validQueries : undefined,
        instructions: instructions.trim() || undefined,
      })
      clearTables()
      const roomId = result.space_id || result.id
      navigate(roomId ? `/rooms/${roomId}` : '/rooms')
    } catch (e: any) { setError(e.message || 'Failed to create room') }
    finally { setCreating(false) }
  }

  // Refresh description validation after edits
  const refreshValidation = async () => {
    setValidating(true)
    try { const r = await api.validateDescriptions(selectedTables); setDescValidation(r) } catch {}
    setValidating(false)
  }

  const [visibleCount, setVisibleCount] = useState(50)
  const q = pickerSearch.toLowerCase()
  const filteredCatalogs = q ? catalogs.filter((c) => c.name.toLowerCase().includes(q)) : catalogs
  const visibleCatalogs = filteredCatalogs.slice(0, visibleCount)

  return (
    <div className="max-w-3xl mx-auto p-8 pb-16">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#D0A33C] to-[#3F1F14] flex items-center justify-center">
          <Plus className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">Create Genie Room</h2>
          <p className="text-sm text-[var(--text-secondary)]">Set up a new AI-powered data room</p>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center mb-8">
        {STEPS.map((s, i) => (
          <div key={s.num} className="flex items-center flex-1">
            <button
              onClick={() => { if (s.num < step) goToStep(s.num) }}
              className={`flex items-center gap-1.5 ${s.num <= step ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                s.num === step ? 'bg-[#D0A33C] text-white' : s.num < step ? 'bg-emerald-500 text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
              }`}>
                {s.num < step ? <Check className="w-3.5 h-3.5" /> : s.num}
              </div>
              <span className={`text-xs font-medium hidden md:inline ${s.num === step ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                {s.label}{(s as any).optional ? <span className="text-[9px] ml-0.5 opacity-60">*</span> : ''}
              </span>
            </button>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-2 ${s.num < step ? 'bg-emerald-500' : 'bg-[var(--border)]'}`} />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
      )}

      {/* ─── Step 1: Setup ─── */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">Room Name</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Sales Analytics"
              className="w-full px-4 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#D0A33C] transition-colors" />
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm font-medium mb-2"><Warehouse className="w-4 h-4 text-[var(--text-secondary)]" /> SQL Warehouse</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[#D0A33C] transition-colors">
              <option value="">{warehouses.length === 0 ? 'Loading warehouses...' : 'Select a warehouse'}</option>
              {warehouses.map((wh) => (<option key={wh.id} value={wh.id}>{wh.name} ({wh.state.replace('STATE_', '').replace('State.', '')})</option>))}
            </select>
            {warehouses.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">No SQL warehouses found. Ensure your workspace has at least one SQL warehouse.</p>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Tables ({selectedTables.length})</label>
              {selectedTables.length > 0 && <button onClick={openPicker} className="text-xs text-[#D0A33C] hover:text-[#D0A33C] font-medium">+ Add more</button>}
            </div>
            {selectedTables.length > 0 && (
              <div className="space-y-2 mb-3">
                {selectedTables.map((table) => (
                  <div key={table} className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
                    <span className="text-sm font-mono text-[#D0A33C]">{table}</span>
                    <button onClick={() => removeTable(table)} className="text-[var(--text-secondary)] hover:text-red-400 transition-colors"><X className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            )}
            {!pickerOpen ? (
              <button onClick={openPicker} className="w-full py-6 rounded-lg border-2 border-dashed border-[var(--border)] hover:border-[#D0A33C]/50 text-[var(--text-secondary)] hover:text-[#D0A33C] transition-colors flex flex-col items-center gap-2">
                <Database className="w-5 h-5" /><span className="text-sm">Browse Catalog to select tables</span>
              </button>
            ) : (
              <CatalogPicker pickerSearch={pickerSearch} setPickerSearch={(v: string) => { setPickerSearch(v); setVisibleCount(50) }}
                searching={searching} searchResults={searchResults} catalogsLoading={catalogsLoading}
                visibleCatalogs={visibleCatalogs} filteredCatalogs={filteredCatalogs} visibleCount={visibleCount}
                setVisibleCount={setVisibleCount} expandedCatalogs={expandedCatalogs} expandedSchemas={expandedSchemas}
                schemas={schemas} tables={tables} loadingNodes={loadingNodes} selectedTables={selectedTables}
                toggleCatalog={toggleCatalog} toggleSchema={toggleSchema} toggleTable={toggleTable}
                onClose={() => setPickerOpen(false)} />
            )}
          </div>
          <button onClick={() => goToStep(2)} disabled={!canProceedStep1}
            className="w-full py-3 rounded-lg bg-[#D0A33C] hover:bg-[#b88d2e] text-white font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            Next: Verify Descriptions <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ─── Step 2: Description Validation + Editing ─── */}
      {step === 2 && (
        <div className="space-y-6">
          {/* Room Description */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-[var(--text-primary)]">Room Description</label>
              <button
                onClick={async () => {
                  setGeneratingDesc(true)
                  try {
                    const r = await api.datasetDescription(selectedTables, warehouseId || undefined)
                    setDescription(r.description)
                  } catch (e: any) { setError(e.message || 'Failed to generate description') }
                  setGeneratingDesc(false)
                }}
                disabled={generatingDesc}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#325B6D]/10 text-[#325B6D] text-xs font-medium hover:bg-[#325B6D]/20 transition-colors disabled:opacity-50"
              >
                {generatingDesc ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating...</> : <><Wand2 className="w-3.5 h-3.5" /> Generate with AI</>}
              </button>
            </div>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this room is for, or click 'Generate with AI' to auto-generate based on selected tables..."
              rows={5}
              className="w-full px-4 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#D0A33C] transition-colors resize-none text-sm" />
          </div>

          {/* Table/Column Description Coverage */}
          {validating ? (
            <div className="flex flex-col items-center justify-center py-16 text-[var(--text-secondary)]">
              <Loader2 className="w-8 h-8 animate-spin mb-3" /><p className="text-sm">Checking table and column descriptions...</p>
            </div>
          ) : descValidation ? (
            <>
              <div className={`p-4 rounded-lg border ${
                descValidation.summary.description_coverage >= 80 ? 'bg-emerald-500/5 border-emerald-500/20'
                  : descValidation.summary.description_coverage >= 50 ? 'bg-amber-500/5 border-amber-500/20'
                    : 'bg-red-500/5 border-red-500/20'
              }`}>
                <div className="flex items-center gap-3 mb-3">
                  {descValidation.summary.description_coverage >= 80
                    ? <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    : <AlertTriangle className="w-5 h-5 text-amber-500" />}
                  <span className="text-sm font-semibold text-[var(--text-primary)]">Description Coverage: {descValidation.summary.description_coverage}%</span>
                  <button onClick={refreshValidation} disabled={validating}
                    className="ml-auto text-xs text-[#D0A33C] hover:text-[#D0A33C] font-medium flex items-center gap-1">
                    <Loader2 className={`w-3 h-3 ${validating ? 'animate-spin' : 'hidden'}`} /> Refresh
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-[var(--text-secondary)]">Tables: </span><span className="font-medium">{descValidation.summary.tables_with_description}/{descValidation.summary.total_tables}</span></div>
                  <div><span className="text-[var(--text-secondary)]">Columns: </span><span className="font-medium">{descValidation.summary.columns_with_description}/{descValidation.summary.total_columns}</span></div>
                </div>
              </div>

              {!warehouseId && (
                <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-sm text-amber-600 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  Select a SQL Warehouse in Step 1 to enable editing and saving descriptions.
                </div>
              )}

              <div className="space-y-3">
                {descValidation.tables.map((t) => (
                  <TableDescriptionCard key={t.full_name} table={t} warehouseId={warehouseId} onSaved={refreshValidation} />
                ))}
              </div>

              {descValidation.summary.description_coverage < 80 && (
                <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-sm text-amber-600">
                  <AlertTriangle className="w-4 h-4 inline mr-1.5" />
                  Low coverage may reduce Genie's accuracy. Add descriptions above or continue anyway.
                </div>
              )}
            </>
          ) : null}

          <div className="flex gap-3">
            <button onClick={() => goToStep(1)}
              className="py-3 px-5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium text-sm transition-colors flex items-center justify-center gap-2">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button onClick={() => goToStep(4)} disabled={validating}
              className="py-3 px-5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] font-medium text-sm transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40">
              <SkipForward className="w-3.5 h-3.5" /> Skip to Instructions
            </button>
            <button onClick={() => goToStep(3)} disabled={validating}
              className="flex-1 py-3 rounded-lg bg-[#D0A33C] hover:bg-[#b88d2e] text-white font-semibold text-sm transition-all disabled:opacity-40 flex items-center justify-center gap-2">
              Next: Analysis <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ─── Step 3: Analysis (Optional) ─── */}
      {step === 3 && (
        <div className="space-y-6">
          <div className="p-4 rounded-lg bg-[#D0A33C]/5 border border-[#D0A33C]/15">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-4 h-4 text-[#D0A33C]" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">Data Analysis</span>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">Optional</span>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              Run optional analyses to understand your data before creating the room. You can skip this step entirely.
            </p>
          </div>

          {/* Analysis action cards */}
          <div className="grid grid-cols-1 gap-3">
            {/* Summary Stats */}
            <AnalysisCard
              icon={Hash} title="Summary Stats" description="Row counts, column counts, and data type distribution for each table"
              loading={statsLoading} done={!!statsResult}
              onRun={async () => {
                setStatsLoading(true)
                try { const r = await api.summaryStats(selectedTables, warehouseId || undefined); setStatsResult(r) } catch (e: any) { setError(e.message) }
                setStatsLoading(false)
              }}
            >
              {statsResult && (
                <div className="space-y-3">
                  {statsResult.tables.map((t) => (
                    <div key={t.full_name} className="p-3 rounded-md bg-[var(--bg-primary)] border border-[var(--border)]">
                      <div className="flex items-center gap-2 mb-2">
                        <Table2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span className="text-sm font-medium text-[var(--text-primary)] truncate">{t.name}</span>
                        <span className="text-[10px] text-[var(--text-secondary)] font-mono">{t.full_name}</span>
                      </div>
                      {'error' in t && t.error ? (
                        <p className="text-xs text-red-500">{t.error}</p>
                      ) : (
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <p className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Rows</p>
                            <p className="text-sm font-semibold text-[var(--text-primary)]">{t.row_count !== null ? t.row_count.toLocaleString() : '—'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Columns</p>
                            <p className="text-sm font-semibold text-[var(--text-primary)]">{t.column_count}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Types</p>
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {Object.entries(t.column_types || {}).map(([type, count]) => (
                                <span key={type} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] font-mono">
                                  {type} ({count})
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </AnalysisCard>

            {/* Time Ranges */}
            <AnalysisCard
              icon={Clock} title="Time Ranges" description="Detect date/timestamp columns and find min/max date ranges"
              loading={timeLoading} done={!!timeResult}
              disabled={!warehouseId}
              disabledReason="Select a SQL Warehouse in Step 1"
              onRun={async () => {
                setTimeLoading(true)
                try { const r = await api.timeRanges(selectedTables, warehouseId); setTimeResult(r) } catch (e: any) { setError(e.message) }
                setTimeLoading(false)
              }}
            >
              {timeResult && (
                <div className="space-y-3">
                  {timeResult.tables.map((t) => (
                    <div key={t.full_name} className="p-3 rounded-md bg-[var(--bg-primary)] border border-[var(--border)]">
                      <div className="flex items-center gap-2 mb-2">
                        <Table2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span className="text-sm font-medium text-[var(--text-primary)]">{t.name}</span>
                      </div>
                      {t.error ? (
                        <p className="text-xs text-red-500">{t.error}</p>
                      ) : t.time_columns.length === 0 ? (
                        <p className="text-xs text-[var(--text-secondary)] italic">No date/timestamp columns found</p>
                      ) : (
                        <div className="space-y-1.5">
                          {t.time_columns.map((tc) => (
                            <div key={tc.column} className="flex items-center gap-3 text-xs">
                              <span className="font-mono text-[var(--text-primary)] min-w-[120px]">{tc.column}</span>
                              <span className="text-[var(--text-secondary)]">({tc.type})</span>
                              {tc.error ? (
                                <span className="text-red-500">{tc.error}</span>
                              ) : (
                                <span className="text-[var(--text-primary)] font-medium">
                                  {tc.min || '?'} → {tc.max || '?'}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </AnalysisCard>

            {/* Dataset Description */}
            <AnalysisCard
              icon={MessageSquarePlus} title="Dataset Description" description="AI-generated description of your dataset — add it to Genie room instructions"
              loading={datasetDescLoading} done={!!datasetDesc}
              onRun={async () => {
                setDatasetDescLoading(true)
                try {
                  const r = await api.datasetDescription(selectedTables, warehouseId || undefined)
                  setDatasetDesc(r.description)
                } catch (e: any) { setError(e.message) }
                setDatasetDescLoading(false)
              }}
            >
              {datasetDesc && (
                <div className="space-y-3">
                  <textarea
                    value={datasetDesc}
                    onChange={(e) => setDatasetDesc(e.target.value)}
                    rows={Math.max(4, Math.ceil(datasetDesc.length / 80))}
                    className="w-full px-3 py-2 rounded-md bg-[var(--bg-primary)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#D0A33C] resize-none"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setInstructions((prev) => prev ? `${prev}\n\n${datasetDesc}` : datasetDesc)
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#D0A33C] text-white text-xs font-medium hover:bg-[#b88d2e] transition-colors"
                    >
                      <MessageSquarePlus className="w-3 h-3" /> Add to Instructions
                    </button>
                    {instructions.includes(datasetDesc) && (
                      <span className="text-xs text-emerald-600 flex items-center gap-1"><Check className="w-3 h-3" /> Added</span>
                    )}
                  </div>
                </div>
              )}
            </AnalysisCard>
          </div>

          <div className="flex gap-3">
            <button onClick={() => goToStep(2)}
              className="flex-1 py-3 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium text-sm transition-colors flex items-center justify-center gap-2">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button onClick={() => goToStep(4)}
              className="flex-1 py-3 rounded-lg bg-[#D0A33C] hover:bg-[#b88d2e] text-white font-semibold text-sm transition-all flex items-center justify-center gap-2">
              Next: SQL Instructions <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ─── Step 4: SQL Instructions ─── */}
      {step === 4 && (
        <div className="space-y-6">
          <div>
            <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1">General Instructions</h3>
            <p className="text-xs text-[var(--text-secondary)] mb-3">Provide guidance for how Genie should answer questions (optional)</p>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g., Always filter by active status. Use fiscal year dates. Revenue should be calculated as quantity * unit_price..."
              rows={4}
              className="w-full px-4 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#D0A33C] transition-colors resize-none text-sm"
            />
          </div>

          {/* SQL Queries & Functions */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-semibold text-[var(--text-primary)]">SQL Queries &amp; Functions</h3>
              <button
                onClick={() => setSampleQueries([...sampleQueries, { question: '', sql: '' }])}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#D0A33C]/10 text-[#D0A33C] text-xs font-medium hover:bg-[#D0A33C]/20 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add Query
              </button>
            </div>
            <p className="text-xs text-[var(--text-secondary)] mb-3">Teach Genie how to answer specific questions. Import from files or write manually.</p>

            {/* Import from files */}
            <div className="mb-4">
              <SqlFileUploader
                onAddToInstructions={(content) => setInstructions((prev) => prev ? `${prev}\n\n${content}` : content)}
                onAddAsQuery={(filename, content) => setSampleQueries((prev) => [...prev, { question: filename.replace(/\.sql$/i, '').replace(/[_-]/g, ' '), sql: content }])}
              />
            </div>

            {sampleQueries.length === 0 && (
              <button
                onClick={() => setSampleQueries([{ question: '', sql: '' }])}
                className="w-full py-8 rounded-lg border-2 border-dashed border-[var(--border)] hover:border-[#D0A33C]/50 text-[var(--text-secondary)] hover:text-[#D0A33C] transition-colors flex flex-col items-center gap-2"
              >
                <Code className="w-5 h-5" />
                <span className="text-sm">Add a SQL query manually</span>
              </button>
            )}

            <div className="space-y-4">
              {sampleQueries.map((sq, idx) => (
                <div key={idx} className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
                  <div className="px-4 py-2.5 bg-[var(--bg-tertiary)] border-b border-[var(--border)] flex items-center justify-between">
                    <span className="text-xs font-medium text-[var(--text-secondary)]">Query {idx + 1}</span>
                    <button
                      onClick={() => setSampleQueries(sampleQueries.filter((_, i) => i !== idx))}
                      className="text-[var(--text-secondary)] hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="p-4 space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Question (what a user would ask)</label>
                      <input
                        type="text"
                        value={sq.question}
                        onChange={(e) => {
                          const updated = [...sampleQueries]
                          updated[idx] = { ...updated[idx], question: e.target.value }
                          setSampleQueries(updated)
                        }}
                        placeholder="e.g., What are the top 10 customers by revenue?"
                        className="w-full px-3 py-2 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#D0A33C] transition-colors text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">SQL</label>
                      <textarea
                        value={sq.sql}
                        onChange={(e) => {
                          const updated = [...sampleQueries]
                          updated[idx] = { ...updated[idx], sql: e.target.value }
                          setSampleQueries(updated)
                        }}
                        placeholder="SELECT customer_name, SUM(revenue) as total_revenue FROM sales GROUP BY customer_name ORDER BY total_revenue DESC LIMIT 10"
                        rows={4}
                        className="w-full px-3 py-2 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#D0A33C] transition-colors text-sm font-mono resize-none"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <StepNav onBack={() => goToStep(3)} onNext={() => goToStep(5)} nextLabel="Next: Review & Create" />
        </div>
      )}

      {/* ─── Step 5: Review & Create ─── */}
      {step === 5 && (
        <div className="space-y-6">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
            <div className="px-4 py-3 bg-[var(--bg-tertiary)] border-b border-[var(--border)]">
              <span className="text-sm font-semibold text-[var(--text-primary)]">Review</span>
            </div>
            <div className="p-4 space-y-4">
              <ReviewRow label="Room Name" value={title} />
              {description && <ReviewRow label="Description" value={description} />}
              <ReviewRow label="Warehouse" value={warehouseId ? warehouses.find((w) => w.id === warehouseId)?.name || warehouseId : 'Auto-select'} />
              <div>
                <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">Tables ({selectedTables.length})</p>
                <div className="space-y-1">
                  {selectedTables.map((t) => (
                    <div key={t} className="flex items-center gap-2 text-sm">
                      <Table2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" /><span className="font-mono text-[#D0A33C]">{t}</span>
                    </div>
                  ))}
                </div>
              </div>
              {descValidation && (
                <div>
                  <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">Description Coverage</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${
                        descValidation.summary.description_coverage >= 80 ? 'bg-emerald-500' : descValidation.summary.description_coverage >= 50 ? 'bg-amber-500' : 'bg-red-500'
                      }`} style={{ width: `${descValidation.summary.description_coverage}%` }} />
                    </div>
                    <span className="text-sm font-medium">{descValidation.summary.description_coverage}%</span>
                  </div>
                </div>
              )}
              {(instructions.trim() || sampleQueries.some(sq => sq.question || sq.sql)) && (
                <div className="p-2.5 rounded-md bg-[#D0A33C]/5 border border-[#D0A33C]/15 text-[11px] text-[var(--text-secondary)]">
                  Instructions and sample queries will be included in the room description as context for Genie.
                </div>
              )}
              {instructions.trim() && (
                <div>
                  <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">Instructions</p>
                  <p className="text-sm text-[var(--text-primary)] bg-[var(--bg-tertiary)] px-3 py-2 rounded-md whitespace-pre-wrap">{instructions}</p>
                </div>
              )}
              {sampleQueries.length > 0 && (() => {
                const validQueries = sampleQueries.filter(sq => sq.question.trim() || sq.sql.trim())
                const emptyCount = sampleQueries.length - validQueries.length
                return (
                  <div>
                    <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">Sample Queries ({validQueries.length})</p>
                    {emptyCount > 0 && (
                      <div className="mb-2 p-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-600">
                        {emptyCount} empty {emptyCount === 1 ? 'query' : 'queries'} will be skipped
                      </div>
                    )}
                    {validQueries.length === 0 && (
                      <p className="text-xs text-[var(--text-secondary)] italic">No queries with content — none will be included</p>
                    )}
                    <div className="space-y-2">
                      {validQueries.map((sq, i) => (
                        <div key={i} className="bg-[var(--bg-tertiary)] px-3 py-2 rounded-md">
                          {sq.question && <p className="text-sm text-[var(--text-primary)] mb-1">{sq.question}</p>}
                          {sq.sql && <pre className="text-xs text-[#D0A33C] font-mono overflow-x-auto">{sq.sql}</pre>}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => goToStep(4)}
              className="flex-1 py-3 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium text-sm transition-colors flex items-center justify-center gap-2">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button onClick={handleCreate} disabled={creating}
              className="flex-1 py-3 rounded-lg bg-gradient-to-r from-[#D0A33C] to-[#3F1F14] hover:from-[#b88d2e] hover:to-[#3F1F14] text-white font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {creating ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : <><Sparkles className="w-4 h-4" /> Create Genie Room</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


// ── Step Nav ──

function StepNav({ onBack, onNext, nextLabel, disabled }: { onBack: () => void; onNext: () => void; nextLabel: string; disabled?: boolean }) {
  return (
    <div className="flex gap-3">
      <button onClick={onBack} className="flex-1 py-3 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium text-sm transition-colors flex items-center justify-center gap-2">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <button onClick={onNext} disabled={disabled}
        className="flex-1 py-3 rounded-lg bg-[#D0A33C] hover:bg-[#b88d2e] text-white font-semibold text-sm transition-all disabled:opacity-40 flex items-center justify-center gap-2">
        {nextLabel} <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-1">{label}</p>
      <p className="text-sm font-medium text-[var(--text-primary)]">{value}</p>
    </div>
  )
}


// ── Table Description Card with Editing ──

function TableDescriptionCard({ table, warehouseId, onSaved }: {
  table: DescriptionValidation['tables'][0]; warehouseId: string; onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  // Manual editing
  const [editingTableDesc, setEditingTableDesc] = useState(false)
  const [tableDesc, setTableDesc] = useState(table.table_comment || '')
  const [savingTableDesc, setSavingTableDesc] = useState(false)
  const [editingCol, setEditingCol] = useState<string | null>(null)
  const [colDesc, setColDesc] = useState('')
  const [savingCol, setSavingCol] = useState(false)
  // AI generation
  const [generating, setGenerating] = useState(false)
  const [generatedTableDesc, setGeneratedTableDesc] = useState<string | null>(null)
  const [generatedColDescs, setGeneratedColDescs] = useState<Record<string, string>>({})
  const [savingAll, setSavingAll] = useState(false)
  const [saveProgress, setSaveProgress] = useState('')

  if (table.error) {
    return (
      <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20 text-sm">
        <span className="font-mono text-red-500">{table.full_name}</span>
        <span className="text-red-400 ml-2">Error: {table.error}</span>
      </div>
    )
  }

  const pct = table.total_columns ? Math.round(((table.described_columns || 0) / table.total_columns) * 100) : 0
  const hasTableDesc = table.has_table_comment
  const allGood = hasTableDesc && pct === 100
  const hasGenerated = generatedTableDesc !== null || Object.keys(generatedColDescs).length > 0

  const generateWithAI = async () => {
    setGenerating(true)
    try {
      const result = await api.generateDescriptions({
        full_name: table.full_name,
        table_name: table.table_name || table.full_name.split('.').pop() || '',
        columns: (table.columns || []).map((c) => ({ name: c.name, type: c.type, comment: c.comment })),
        existing_comment: table.table_comment || '',
      })
      setGeneratedTableDesc(result.table_description || '')
      setGeneratedColDescs(result.columns || {})
      setOpen(true)
    } catch {}
    setGenerating(false)
  }

  const [saveError, setSaveError] = useState('')

  const saveTableDesc = async () => {
    if (!warehouseId) return
    setSavingTableDesc(true); setSaveError('')
    try {
      await api.updateTableDescription(table.full_name, tableDesc, warehouseId)
      setEditingTableDesc(false)
      onSaved()
    } catch (e: any) { setSaveError(e.message || 'Failed to save table description') }
    setSavingTableDesc(false)
  }

  const saveColDesc = async (colName: string) => {
    if (!warehouseId) return
    setSavingCol(true); setSaveError('')
    try {
      await api.updateColumnDescription(table.full_name, colName, colDesc, warehouseId)
      setEditingCol(null)
      onSaved()
    } catch (e: any) { setSaveError(e.message || 'Failed to save column description') }
    setSavingCol(false)
  }

  const saveAllGenerated = async () => {
    if (!warehouseId) return
    setSavingAll(true); setSaveError('')
    let saved = 0
    const total = (generatedTableDesc ? 1 : 0) + Object.keys(generatedColDescs).length
    try {
      if (generatedTableDesc) {
        setSaveProgress(`Saving table description...`)
        await api.updateTableDescription(table.full_name, generatedTableDesc, warehouseId)
        saved++
      }
      for (const [colName, desc] of Object.entries(generatedColDescs)) {
        if (!desc) continue
        setSaveProgress(`Saving column ${saved + 1}/${total}...`)
        await api.updateColumnDescription(table.full_name, colName, desc, warehouseId)
        saved++
      }
      setGeneratedTableDesc(null)
      setGeneratedColDescs({})
      setSaveProgress('')
      onSaved()
    } catch (e: any) {
      setSaveProgress(`Saved ${saved}/${total} — some failed`)
      setSaveError(e.message || 'Failed to save some descriptions')
    }
    setSavingAll(false)
  }

  const discardGenerated = () => {
    setGeneratedTableDesc(null)
    setGeneratedColDescs({})
  }

  return (
    <div className={`rounded-lg border overflow-hidden ${allGood && !hasGenerated ? 'border-emerald-500/20' : hasGenerated ? 'border-[#325B6D]/30' : 'border-amber-500/20'}`}>
      <div className="flex items-center">
        <button onClick={() => setOpen(!open)} className="flex-1 flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--bg-hover)] transition-colors min-w-0">
          {allGood ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)] truncate">{table.full_name}</p>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-[var(--text-secondary)]">
              <span className={hasTableDesc ? 'text-emerald-600' : 'text-amber-600'}>{hasTableDesc ? 'Has description' : 'No description'}</span>
              <span>Columns: {table.described_columns}/{table.total_columns}</span>
              {hasGenerated && <span className="text-[#325B6D] font-medium">AI draft ready</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-16 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${pct === 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[11px] font-medium text-[var(--text-secondary)] w-8 text-right">{pct}%</span>
            {open ? <ChevronDown className="w-4 h-4 text-[var(--text-secondary)]" /> : <ChevronRight className="w-4 h-4 text-[var(--text-secondary)]" />}
          </div>
        </button>
        {/* Generate button in header */}
        {!hasGenerated && (
          <button onClick={(e) => { e.stopPropagation(); generateWithAI() }} disabled={generating}
            className="mr-3 px-2.5 py-1.5 rounded-md bg-[#325B6D]/10 text-[#325B6D] text-[11px] font-medium hover:bg-[#325B6D]/20 disabled:opacity-50 transition-colors flex items-center gap-1 shrink-0"
            title="Generate descriptions with AI">
            {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
            {generating ? 'Generating...' : 'Generate'}
          </button>
        )}
      </div>
      {open && (
        <div className="px-4 pb-3 border-t border-[var(--border)]">
          {/* Save error */}
          {saveError && (
            <div className="mt-3 p-2.5 rounded-md bg-red-500/5 border border-red-500/20 text-xs text-red-500 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1">{saveError}</span>
              <button onClick={() => setSaveError('')} className="text-red-400 hover:text-red-600"><X className="w-3 h-3" /></button>
            </div>
          )}
          {/* AI-generated banner + save all */}
          {hasGenerated && (
            <div className="mt-3 mb-3 p-3 rounded-lg bg-[#325B6D]/5 border border-[#325B6D]/20">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Wand2 className="w-3.5 h-3.5 text-[#325B6D]" />
                  <span className="text-xs font-semibold text-[#325B6D]">AI-Generated Descriptions</span>
                </div>
                <div className="flex items-center gap-2">
                  {saveProgress && <span className="text-[10px] text-[var(--text-secondary)]">{saveProgress}</span>}
                  <button onClick={discardGenerated} disabled={savingAll}
                    className="px-2 py-1 rounded-md text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors">
                    Discard
                  </button>
                  <button onClick={saveAllGenerated} disabled={savingAll || !warehouseId}
                    className="px-2.5 py-1 rounded-md bg-[#325B6D] text-white text-[10px] font-medium hover:bg-[#274a59] disabled:opacity-50 flex items-center gap-1 transition-colors"
                    title={!warehouseId ? 'Select a warehouse in Step 1 first' : 'Save all descriptions to Unity Catalog'}>
                    {savingAll ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Save className="w-2.5 h-2.5" />} Save All to UC
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-[var(--text-secondary)]">
                Review the generated descriptions below. Edit any you'd like to change, then click "Save All to UC" to write them to Unity Catalog.{!warehouseId && ' You need to select a SQL warehouse in Step 1 first.'}
              </p>
            </div>
          )}

          {/* Table description */}
          <div className="mt-3 mb-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-medium text-[var(--text-secondary)]">Table Description</span>
              {!editingTableDesc && !hasGenerated && warehouseId && (
                <button onClick={() => { setTableDesc(table.table_comment || ''); setEditingTableDesc(true) }}
                  className="text-xs text-[#D0A33C] hover:text-[#D0A33C] flex items-center gap-1"><Pencil className="w-3 h-3" /> Edit</button>
              )}
            </div>
            {hasGenerated && generatedTableDesc !== null ? (
              <textarea value={generatedTableDesc} onChange={(e) => setGeneratedTableDesc(e.target.value)}
                rows={Math.max(2, Math.ceil((generatedTableDesc || '').length / 80))}
                className="w-full px-3 py-1.5 rounded-md bg-[#325B6D]/5 border border-[#325B6D]/20 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#325B6D] resize-none" />
            ) : editingTableDesc ? (
              <div className="space-y-2">
                <textarea value={tableDesc} onChange={(e) => setTableDesc(e.target.value)}
                  placeholder="Add a description for this table..."
                  rows={Math.max(2, Math.ceil((tableDesc || '').length / 80))}
                  className="w-full px-3 py-1.5 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#D0A33C] resize-none"
                  autoFocus />
                <div className="flex gap-2">
                  <button onClick={saveTableDesc} disabled={savingTableDesc}
                    className="px-3 py-1.5 rounded-md bg-[#D0A33C] text-white text-xs font-medium hover:bg-[#b88d2e] disabled:opacity-50 flex items-center gap-1">
                    {savingTableDesc ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
                  </button>
                  <button onClick={() => setEditingTableDesc(false)} className="px-2 py-1.5 rounded-md bg-[var(--bg-tertiary)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Cancel</button>
                </div>
              </div>
            ) : (
              <p className={`text-sm ${table.table_comment ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] italic'}`}>
                {table.table_comment || 'No description'}
              </p>
            )}
          </div>

          {/* Columns */}
          <div className="space-y-1">
            {table.columns?.map((c) => {
              const genDesc = generatedColDescs[c.name]
              return (
                <div key={c.name} className="py-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    {c.has_comment ? <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" /> : <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />}
                    <span className="font-mono text-[var(--text-primary)]">{c.name}</span>
                    <span className="text-[var(--text-secondary)]">({c.type})</span>
                    {!hasGenerated && c.has_comment && editingCol !== c.name && (
                      <span className="text-[var(--text-secondary)] truncate ml-auto max-w-[40%]">{c.comment}</span>
                    )}
                    {!hasGenerated && !c.has_comment && editingCol !== c.name && warehouseId && (
                      <button onClick={() => { setEditingCol(c.name); setColDesc(c.comment || '') }}
                        className="ml-auto text-[10px] text-[#D0A33C] hover:text-[#D0A33C] flex items-center gap-0.5"><Pencil className="w-2.5 h-2.5" /> Add</button>
                    )}
                    {!hasGenerated && c.has_comment && editingCol !== c.name && warehouseId && (
                      <button onClick={() => { setEditingCol(c.name); setColDesc(c.comment || '') }}
                        className="text-[10px] text-[#D0A33C] hover:text-[#D0A33C] flex items-center gap-0.5 shrink-0"><Pencil className="w-2.5 h-2.5" /></button>
                    )}
                  </div>
                  {/* AI-generated column description (editable inline) */}
                  {hasGenerated && genDesc !== undefined && (
                    <div className="ml-5 mt-1">
                      <input type="text" value={genDesc} onChange={(e) => setGeneratedColDescs((prev) => ({ ...prev, [c.name]: e.target.value }))}
                        className="w-full px-2.5 py-1 rounded-md bg-[#325B6D]/5 border border-[#325B6D]/20 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[#325B6D]" />
                    </div>
                  )}
                  {/* Show existing description when generated is present but not for this column */}
                  {hasGenerated && genDesc === undefined && c.comment && (
                    <div className="ml-5 mt-0.5 text-xs text-[var(--text-secondary)]">{c.comment}</div>
                  )}
                  {/* Manual editing */}
                  {!hasGenerated && editingCol === c.name && (
                    <div className="flex gap-2 mt-1.5 ml-5">
                      <input type="text" value={colDesc} onChange={(e) => setColDesc(e.target.value)}
                        placeholder={`Describe ${c.name}...`}
                        className="flex-1 px-2.5 py-1 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[#D0A33C]"
                        autoFocus onKeyDown={(e) => { if (e.key === 'Enter') saveColDesc(c.name) }} />
                      <button onClick={() => saveColDesc(c.name)} disabled={savingCol}
                        className="px-2 py-1 rounded-md bg-[#D0A33C] text-white text-[10px] font-medium hover:bg-[#b88d2e] disabled:opacity-50 flex items-center gap-1">
                        {savingCol ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Save className="w-2.5 h-2.5" />} Save
                      </button>
                      <button onClick={() => setEditingCol(null)} className="px-2 py-1 rounded-md bg-[var(--bg-tertiary)] text-[10px] text-[var(--text-secondary)]">Cancel</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}


// ── SQL File Uploader (local + workspace) ──

function SqlFileUploader({ onAddAsQuery }: {
  onAddToInstructions: (content: string) => void
  onAddAsQuery: (filename: string, content: string) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showWorkspaceBrowser, setShowWorkspaceBrowser] = useState(false)
  const [wsPath, setWsPath] = useState('/')
  const [wsItems, setWsItems] = useState<WorkspaceItem[]>([])
  const [wsLoading, setWsLoading] = useState(false)
  const [wsReadingFile, setWsReadingFile] = useState('')
  const [addedFiles, setAddedFiles] = useState<{ name: string; target: 'instructions' | 'query' }[]>([])

  const addFile = (name: string, content: string) => {
    onAddAsQuery(name, content)
    setAddedFiles((prev) => [...prev, { name, target: 'query' }])
  }

  const handleLocalFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList) return
    Array.from(fileList).forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => {
        const content = (reader.result as string).trim()
        if (content) addFile(file.name, content)
      }
      reader.readAsText(file)
    })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const browseWorkspace = async (path: string) => {
    setWsLoading(true)
    setWsPath(path)
    try {
      const r = await api.listWorkspacePath(path)
      setWsItems(r.items)
    } catch { setWsItems([]) }
    setWsLoading(false)
  }

  const [importError, setImportError] = useState('')

  const importWorkspaceFile = async (item: WorkspaceItem) => {
    if (addedFiles.some((f) => f.name === item.name)) return
    setWsReadingFile(item.path)
    setImportError('')
    try {
      const r = await api.readWorkspaceFile(item.path)
      if (r.content.trim()) {
        addFile(item.name, r.content.trim())
      } else {
        setImportError(`File "${item.name}" is empty`)
      }
    } catch (e: any) {
      setImportError(`Failed to import "${item.name}": ${e.message || 'Unknown error'}`)
    }
    setWsReadingFile('')
  }

  const parentPath = wsPath === '/' ? null : wsPath.replace(/\/[^/]+$/, '') || '/'
  const addedNames = new Set(addedFiles.map((f) => f.name))

  return (
    <div className="space-y-3">
      <input ref={fileInputRef} type="file" accept=".sql,.txt" multiple onChange={handleLocalFiles} className="hidden" />

      {/* Source buttons */}
      <div className="flex gap-2">
        <button onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs font-medium text-[var(--text-secondary)] hover:text-[#D0A33C] hover:border-[#D0A33C]/30 transition-colors">
          <Upload className="w-3.5 h-3.5" /> Upload from computer
        </button>
        <button onClick={() => { setShowWorkspaceBrowser(true); browseWorkspace(wsPath === '/' ? '/' : wsPath) }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs font-medium text-[var(--text-secondary)] hover:text-[#325B6D] hover:border-[#325B6D]/30 transition-colors">
          <FolderOpen className="w-3.5 h-3.5" /> Browse workspace
        </button>
      </div>

      {/* Workspace browser */}
      {showWorkspaceBrowser && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
          <div className="px-3 py-2.5 bg-[var(--bg-tertiary)] border-b border-[var(--border)] flex items-center gap-2">
            <FolderOpen className="w-3.5 h-3.5 text-[#325B6D]" />
            <span className="text-xs font-semibold text-[var(--text-primary)] flex-1 truncate">{wsPath}</span>
            <button onClick={() => setShowWorkspaceBrowser(false)}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><X className="w-3.5 h-3.5" /></button>
          </div>
          <div className="max-h-52 overflow-y-auto p-1.5 space-y-0.5">
            {wsLoading ? (
              <div className="flex items-center justify-center py-6 text-[var(--text-secondary)] text-sm"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading...</div>
            ) : (
              <>
                {parentPath !== null && (
                  <button onClick={() => browseWorkspace(parentPath)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors text-[var(--text-secondary)]">
                    <ArrowLeft className="w-3.5 h-3.5" /> <span>..</span>
                  </button>
                )}
                {wsItems.map((item) => {
                  const isDir = item.type === 'DIRECTORY'
                  const alreadyAdded = addedNames.has(item.name)
                  return (
                    <button key={item.path}
                      onClick={() => isDir ? browseWorkspace(item.path) : !alreadyAdded && importWorkspaceFile(item)}
                      disabled={(!isDir && alreadyAdded) || wsReadingFile === item.path}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-colors ${alreadyAdded && !isDir ? 'bg-emerald-500/5' : 'hover:bg-[var(--bg-hover)]'} disabled:opacity-60`}>
                      {isDir ? <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" /> : <FileText className={`w-3.5 h-3.5 shrink-0 ${alreadyAdded ? 'text-emerald-500' : item.is_sql ? 'text-[#D0A33C]' : 'text-[var(--text-secondary)]'}`} />}
                      <span className={`flex-1 text-left truncate ${alreadyAdded ? 'text-emerald-600' : item.is_sql ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'}`}>{item.name}</span>
                      {wsReadingFile === item.path && <Loader2 className="w-3 h-3 animate-spin text-[#D0A33C]" />}
                      {!isDir && alreadyAdded && <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium"><CheckCircle2 className="w-3 h-3" /> Added as query</span>}
                      {!isDir && item.is_sql && !alreadyAdded && wsReadingFile !== item.path && <span className="text-[10px] text-[#D0A33C] font-medium">Import</span>}
                      {isDir && <ChevronRight className="w-3 h-3 text-[var(--text-secondary)]" />}
                    </button>
                  )
                })}
                {wsItems.length === 0 && !wsLoading && (
                  <p className="text-center py-4 text-xs text-[var(--text-secondary)]">Empty directory</p>
                )}
              </>
            )}
          </div>
          {importError && (
            <div className="px-3 py-2 border-t border-red-500/20 bg-red-500/5 text-xs text-red-500 flex items-center gap-2">
              <AlertTriangle className="w-3 h-3 shrink-0" />{importError}
              <button onClick={() => setImportError('')} className="ml-auto"><X className="w-3 h-3" /></button>
            </div>
          )}
        </div>
      )}

      {/* Added files summary */}
      {addedFiles.length > 0 && (
        <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3">
          <p className="text-xs font-semibold text-emerald-600 mb-2">
            <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />{addedFiles.length} file{addedFiles.length > 1 ? 's' : ''} added as sample queries
          </p>
          <div className="space-y-1">
            {addedFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-emerald-700">
                <FileText className="w-3 h-3" />
                <span className="truncate">{f.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}


// ── Analysis Card ──

function AnalysisCard({ icon: Icon, title, description, loading, done, disabled, disabledReason, onRun, children }: {
  icon: typeof Hash; title: string; description: string; loading: boolean; done: boolean
  disabled?: boolean; disabledReason?: string; onRun: () => void; children?: React.ReactNode
}) {
  return (
    <div className={`rounded-lg border overflow-hidden ${done ? 'border-emerald-500/20 bg-[var(--bg-secondary)]' : 'border-[var(--border)] bg-[var(--bg-secondary)]'}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${done ? 'bg-emerald-500/10' : 'bg-[var(--bg-tertiary)]'}`}>
          <Icon className={`w-4.5 h-4.5 ${done ? 'text-emerald-500' : 'text-[var(--text-secondary)]'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h4>
            {done && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
          </div>
          <p className="text-xs text-[var(--text-secondary)]">{description}</p>
        </div>
        {!done && (
          <button onClick={onRun} disabled={loading || disabled}
            className="shrink-0 px-3 py-1.5 rounded-md bg-[#D0A33C]/10 text-[#D0A33C] text-xs font-medium hover:bg-[#D0A33C]/20 disabled:opacity-40 transition-colors flex items-center gap-1.5"
            title={disabled ? disabledReason : undefined}>
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <BarChart3 className="w-3 h-3" />}
            {loading ? 'Running...' : 'Run'}
          </button>
        )}
        {done && !loading && (
          <button onClick={onRun}
            className="shrink-0 px-2.5 py-1 rounded-md text-[var(--text-secondary)] text-[11px] font-medium hover:bg-[var(--bg-tertiary)] transition-colors">
            Re-run
          </button>
        )}
      </div>
      {disabled && !done && disabledReason && (
        <div className="px-4 pb-3">
          <p className="text-[11px] text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {disabledReason}</p>
        </div>
      )}
      {children && (
        <div className="px-4 pb-4 border-t border-[var(--border)] pt-3">
          {children}
        </div>
      )}
    </div>
  )
}


// ── Catalog Picker ──

function CatalogPicker({
  pickerSearch, setPickerSearch, searching, searchResults,
  catalogsLoading, visibleCatalogs, filteredCatalogs, visibleCount, setVisibleCount,
  expandedCatalogs, expandedSchemas, schemas, tables, loadingNodes,
  selectedTables, toggleCatalog, toggleSchema, toggleTable, onClose,
}: any) {
  const q = pickerSearch.trim()
  const hasActiveSearch = q.length >= 2

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
      <div className="px-3 py-2.5 border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-secondary)]" />
          <input type="text" value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)}
            placeholder="Search tables (e.g. trips or catalog.schema.table)..."
            className="w-full pl-8 pr-8 py-1.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#D0A33C] transition-colors text-sm"
            autoFocus />
          {pickerSearch && <button onClick={() => setPickerSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><X className="w-3.5 h-3.5" /></button>}
        </div>
      </div>
      <div className="max-h-72 overflow-y-auto p-2">
        {/* Search results */}
        {hasActiveSearch && (
          <>
            {searching && (
              <div className="flex items-center justify-center py-8 text-[var(--text-secondary)] text-sm"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Searching...</div>
            )}
            {!searching && searchResults.length > 0 && searchResults.map((r: CatalogSearchResult) => {
              if (r.type === 'table') {
                const isSelected = selectedTables.includes(r.full_name)
                return (
                  <button key={r.full_name} onClick={() => toggleTable(r.full_name)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors">
                    <div className={`shrink-0 rounded border flex items-center justify-center ${isSelected ? 'bg-[#D0A33C] border-[#D0A33C]' : 'border-[var(--border)]'}`} style={{ width: 18, height: 18 }}>
                      {isSelected && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <Table2 className="w-3.5 h-3.5 text-emerald-500" />
                    <div className="flex flex-col min-w-0 flex-1 text-left">
                      <span className="truncate font-medium">{r.name}</span>
                      <span className="text-[11px] text-[var(--text-secondary)] truncate">{r.catalog}.{r.schema}</span>
                    </div>
                    {r.comment && <span className="text-[11px] text-[var(--text-secondary)] truncate max-w-[200px] hidden lg:inline">{r.comment}</span>}
                  </button>
                )
              }
              return (
                <button key={r.full_name} onClick={() => {
                  // Drill down: set search to namespace prefix to show children
                  if (r.type === 'catalog') {
                    setPickerSearch(`${r.name}.`)
                  } else if (r.type === 'schema' && r.catalog) {
                    setPickerSearch(`${r.catalog}.${r.name}.`)
                  }
                }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors">
                  {r.type === 'catalog' ? <Database className="w-3.5 h-3.5 text-[#D0A33C]" /> : <Layers className="w-3.5 h-3.5 text-[#325B6D]" />}
                  <span className="font-medium">{r.name}</span>
                  <span className="ml-auto text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">
                    {r.type === 'catalog' ? 'catalog' : 'schema'} &rsaquo;
                  </span>
                </button>
              )
            })}
            {!searching && searchResults.length === 0 && (
              <p className="text-center py-6 text-sm text-[var(--text-secondary)]">No results for &ldquo;{q}&rdquo;</p>
            )}
          </>
        )}

        {/* Catalog tree browser (when no active search) */}
        {!hasActiveSearch && (
          <>
            {catalogsLoading && <div className="flex items-center justify-center py-8 text-[var(--text-secondary)] text-sm"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading catalogs...</div>}
            {visibleCatalogs.map((cat: Catalog) => (
              <div key={cat.name}>
                <button onClick={() => toggleCatalog(cat.name)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors">
                  {loadingNodes.has(cat.name) ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-secondary)]" /> : expandedCatalogs.has(cat.name) ? <ChevronDown className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> : <ChevronRight className="w-3.5 h-3.5 text-[var(--text-secondary)]" />}
                  <Database className="w-3.5 h-3.5 text-[#D0A33C]" /><span className="font-medium">{cat.name}</span>
                </button>
                {expandedCatalogs.has(cat.name) && schemas[cat.name]?.map((sch: Schema) => {
                  const sk = `${cat.name}.${sch.name}`
                  return (
                    <div key={sch.name} className="ml-4">
                      <button onClick={() => toggleSchema(cat.name, sch.name)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors">
                        {loadingNodes.has(sk) ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-secondary)]" /> : expandedSchemas.has(sk) ? <ChevronDown className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> : <ChevronRight className="w-3.5 h-3.5 text-[var(--text-secondary)]" />}
                        <Layers className="w-3.5 h-3.5 text-[#325B6D]" /><span>{sch.name}</span>
                      </button>
                      {expandedSchemas.has(sk) && tables[sk]?.map((tbl: Table) => {
                        const isSel = selectedTables.includes(tbl.full_name)
                        return (
                          <button key={tbl.name} onClick={() => toggleTable(tbl.full_name)} className="w-full ml-4 flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors">
                            <div className={`shrink-0 rounded border flex items-center justify-center ${isSel ? 'bg-[#D0A33C] border-[#D0A33C]' : 'border-[var(--border)]'}`} style={{ width: 18, height: 18 }}>
                              {isSel && <Check className="w-3 h-3 text-white" />}
                            </div>
                            <Table2 className="w-3.5 h-3.5 text-emerald-500" /><span className="truncate">{tbl.name}</span>
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            ))}
            {visibleCount < filteredCatalogs.length && (
              <button onClick={() => setVisibleCount((c: number) => c + 50)} className="w-full py-2 text-xs text-[#D0A33C] font-medium">Show more ({filteredCatalogs.length - visibleCount})</button>
            )}
          </>
        )}
      </div>
      <div className="px-3 py-2 border-t border-[var(--border)] bg-[var(--bg-tertiary)] flex items-center justify-between">
        <span className="text-xs text-[var(--text-secondary)]">{selectedTables.length} selected</span>
        <button onClick={onClose} className="text-xs font-medium text-[#D0A33C] hover:text-[#D0A33C]">Done</button>
      </div>
    </div>
  )
}


// ── Markdown renderer ──

