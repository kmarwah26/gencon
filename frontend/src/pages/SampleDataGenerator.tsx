import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Loader2,
  Database,
  Check,
  Factory,
  ShoppingCart,
  Landmark,
  Truck,
  Stethoscope,
  Radio,
  Table2,
  Calendar,
  Hash,
  Warehouse,
  FolderPlus,
  AlertCircle,
  Sparkles,
  X,
} from 'lucide-react'
import { api } from '../api'
import type { SampleIndustry, Warehouse as WarehouseType, Catalog, Schema } from '../api'

const INDUSTRY_ICONS: Record<string, any> = {
  retail: ShoppingCart,
  finance: Landmark,
  supply_chain: Truck,
  manufacturing: Factory,
  healthcare: Stethoscope,
  telecom: Radio,
}

const INDUSTRY_COLORS: Record<string, string> = {
  retail: 'from-blue-500 to-indigo-600',
  finance: 'from-emerald-500 to-teal-600',
  supply_chain: 'from-amber-500 to-orange-600',
  manufacturing: 'from-slate-500 to-zinc-600',
  healthcare: 'from-rose-500 to-pink-600',
  telecom: 'from-violet-500 to-purple-600',
}

type Step = 'industry' | 'location' | 'config' | 'descriptions' | 'generate'

export default function SampleDataGenerator() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('industry')
  const [industries, setIndustries] = useState<SampleIndustry[]>([])
  const [loadingIndustries, setLoadingIndustries] = useState(true)

  // Selections
  const [selectedIndustry, setSelectedIndustry] = useState<SampleIndustry | null>(null)
  const [warehouses, setWarehouses] = useState<WarehouseType[]>([])
  const [selectedWarehouse, setSelectedWarehouse] = useState('')
  const [catalogs, setCatalogs] = useState<Catalog[]>([])
  const [schemas, setSchemas] = useState<Schema[]>([])
  const [selectedCatalog, setSelectedCatalog] = useState('')
  const [selectedSchema, setSelectedSchema] = useState('')
  const [createNewSchema, setCreateNewSchema] = useState(false)
  const [newSchemaName, setNewSchemaName] = useState('')
  const [dateStart, setDateStart] = useState('2024-01-01')
  const [dateEnd, setDateEnd] = useState('2024-12-31')
  const [rowCount, setRowCount] = useState(1000)
  const [includeDescriptions, setIncludeDescriptions] = useState(false)

  // Generation state
  const [generating, setGenerating] = useState(false)
  const [tableResults, setTableResults] = useState<
    { table: string; status: string; error?: string }[]
  >([])
  const [currentTable, setCurrentTable] = useState('')

  useEffect(() => {
    api.sampleDataIndustries()
      .then((r) => { setIndustries(r.industries); setLoadingIndustries(false) })
      .catch(() => setLoadingIndustries(false))
  }, [])

  useEffect(() => {
    if (step === 'location') {
      api.listWarehouses().then((r) => setWarehouses(r.warehouses)).catch(() => {})
      api.listCatalogs().then((r) => setCatalogs(r.catalogs)).catch(() => {})
    }
  }, [step])

  useEffect(() => {
    if (selectedCatalog) {
      setSelectedSchema('')
      setSchemas([])
      api.listSchemas(selectedCatalog).then((r) => setSchemas(r.schemas)).catch(() => {})
    }
  }, [selectedCatalog])

  const schemaName = createNewSchema ? newSchemaName : selectedSchema
  const canProceedLocation = selectedWarehouse && selectedCatalog && schemaName

  const handleGenerate = async () => {
    if (!selectedIndustry || !selectedWarehouse || !selectedCatalog || !schemaName) return

    setStep('generate')
    setGenerating(true)
    setTableResults([])

    try {
      // Always ensure schema exists (CREATE SCHEMA IF NOT EXISTS is idempotent)
      await api.sampleDataCreateSchema({
        industry: selectedIndustry.id,
        catalog: selectedCatalog,
        schema_name: schemaName,
        create_schema: true,
        warehouse_id: selectedWarehouse,
        date_start: dateStart,
        date_end: dateEnd,
        row_count: rowCount,
      })

      // Generate each table sequentially
      for (const tableName of selectedIndustry.tables) {
        setCurrentTable(tableName)
        try {
          const result = await api.sampleDataGenerateTable({
            industry: selectedIndustry.id,
            table_name: tableName,
            all_tables: selectedIndustry.tables,
            catalog: selectedCatalog,
            schema_name: schemaName,
            date_start: dateStart,
            date_end: dateEnd,
            row_count: rowCount,
            warehouse_id: selectedWarehouse,
            include_descriptions: includeDescriptions,
          })
          setTableResults((prev) => [
            ...prev,
            { table: tableName, status: result.status, error: undefined },
          ])
        } catch (e: any) {
          setTableResults((prev) => [
            ...prev,
            { table: tableName, status: 'FAILED', error: e.message },
          ])
        }
      }
    } finally {
      setCurrentTable('')
      setGenerating(false)
    }
  }

  const retryTable = async (tableName: string) => {
    if (!selectedIndustry || !selectedWarehouse || !selectedCatalog || !schemaName) return
    // Remove the failed entry
    setTableResults((prev) => prev.filter((r) => r.table !== tableName))
    setCurrentTable(tableName)
    setGenerating(true)
    try {
      const result = await api.sampleDataGenerateTable({
        industry: selectedIndustry.id,
        table_name: tableName,
        all_tables: selectedIndustry.tables,
        catalog: selectedCatalog,
        schema_name: schemaName,
        date_start: dateStart,
        date_end: dateEnd,
        row_count: rowCount,
        warehouse_id: selectedWarehouse,
        include_descriptions: includeDescriptions,
      })
      setTableResults((prev) => [
        ...prev,
        { table: tableName, status: result.status, error: undefined },
      ])
    } catch (e: any) {
      setTableResults((prev) => [
        ...prev,
        { table: tableName, status: 'FAILED', error: e.message },
      ])
    } finally {
      setCurrentTable('')
      setGenerating(false)
    }
  }

  const IndustryIcon = selectedIndustry ? (INDUSTRY_ICONS[selectedIndustry.id] || Database) : Database

  return (
    <div className="max-w-3xl mx-auto px-8 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">Sample Data Generator</h2>
          <p className="text-sm text-[var(--text-secondary)]">
            Generate realistic industry-specific tables in your Unity Catalog
          </p>
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2 mb-8">
        {[
          { key: 'industry', label: 'Industry' },
          { key: 'location', label: 'Location' },
          { key: 'config', label: 'Configure' },
          { key: 'descriptions', label: 'Metadata' },
          { key: 'generate', label: 'Generate' },
        ].map((s, i) => {
          const steps: Step[] = ['industry', 'location', 'config', 'descriptions', 'generate']
          const currentIdx = steps.indexOf(step)
          const sIdx = i
          const isActive = s.key === step
          const isDone = sIdx < currentIdx
          return (
            <div key={s.key} className="flex items-center gap-2">
              {i > 0 && (
                <div className={`w-8 h-px ${isDone || isActive ? 'bg-[#D0A33C]' : 'bg-[var(--border)]'}`} />
              )}
              <div className="flex items-center gap-1.5">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    isDone
                      ? 'bg-[#D0A33C] text-white'
                      : isActive
                        ? 'bg-[#D0A33C]/20 text-[#D0A33C] border border-[#D0A33C]'
                        : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border)]'
                  }`}
                >
                  {isDone ? <Check className="w-3 h-3" /> : i + 1}
                </div>
                <span
                  className={`text-xs font-medium ${
                    isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
                  }`}
                >
                  {s.label}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Step 1: Industry Selection */}
      {step === 'industry' && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Choose an industry</h3>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            Select the type of sample data to generate. Each industry includes a set of related tables with realistic schemas and data.
          </p>
          {loadingIndustries ? (
            <div className="flex items-center justify-center py-12 text-[var(--text-secondary)] text-sm">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading industries...
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {industries.map((ind) => {
                const Icon = INDUSTRY_ICONS[ind.id] || Database
                const color = INDUSTRY_COLORS[ind.id] || 'from-gray-500 to-gray-600'
                const isSelected = selectedIndustry?.id === ind.id
                return (
                  <button
                    key={ind.id}
                    onClick={() => setSelectedIndustry(ind)}
                    className={`text-left p-4 rounded-xl border transition-all ${
                      isSelected
                        ? 'bg-[#D0A33C]/10 border-[#D0A33C]/40 shadow-md'
                        : 'bg-[var(--bg-secondary)] border-[var(--border)] hover:border-[var(--text-secondary)]'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center shrink-0`}>
                        <Icon className="w-5 h-5 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-[var(--text-primary)]">
                            {ind.label}
                          </p>
                          {isSelected && <Check className="w-4 h-4 text-[#D0A33C]" />}
                        </div>
                        <p className="text-[11px] text-[var(--text-secondary)] mt-0.5 leading-snug">
                          {ind.description}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {ind.tables.map((t) => (
                            <span
                              key={t}
                              className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
          <div className="flex justify-end pt-4">
            <button
              onClick={() => setStep('location')}
              disabled={!selectedIndustry}
              className="px-5 py-2.5 rounded-lg bg-[#D0A33C] hover:bg-[#b88d2e] text-white text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next: Choose Location
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Catalog / Schema / Warehouse */}
      {step === 'location' && (
        <div className="space-y-5">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Where to store the data</h3>
          <p className="text-sm text-[var(--text-secondary)]">
            Choose a catalog and schema for the {selectedIndustry?.label} tables, and a SQL warehouse to execute the creation statements.
          </p>

          {/* Warehouse */}
          <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
              <Warehouse className="w-3.5 h-3.5 inline mr-1" /> SQL Warehouse
            </label>
            <select
              value={selectedWarehouse}
              onChange={(e) => setSelectedWarehouse(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#D0A33C]"
            >
              <option value="">Select a warehouse...</option>
              {warehouses.map((wh) => (
                <option key={wh.id} value={wh.id}>
                  {wh.name} ({wh.state})
                </option>
              ))}
            </select>
          </div>

          {/* Catalog */}
          <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
              <Database className="w-3.5 h-3.5 inline mr-1" /> Catalog
            </label>
            <select
              value={selectedCatalog}
              onChange={(e) => setSelectedCatalog(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#D0A33C]"
            >
              <option value="">Select a catalog...</option>
              {catalogs.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Schema */}
          <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
              <FolderPlus className="w-3.5 h-3.5 inline mr-1" /> Schema
            </label>
            <div className="flex items-center gap-3 mb-2">
              <button
                onClick={() => setCreateNewSchema(false)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  !createNewSchema
                    ? 'bg-[#D0A33C]/15 text-[#D0A33C] border border-[#D0A33C]/30'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border)]'
                }`}
              >
                Existing Schema
              </button>
              <button
                onClick={() => setCreateNewSchema(true)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  createNewSchema
                    ? 'bg-[#D0A33C]/15 text-[#D0A33C] border border-[#D0A33C]/30'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border)]'
                }`}
              >
                Create New
              </button>
            </div>
            {createNewSchema ? (
              <input
                type="text"
                value={newSchemaName}
                onChange={(e) => setNewSchemaName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                placeholder={`e.g. ${selectedIndustry?.id || 'sample'}_data`}
                className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#D0A33C]"
              />
            ) : (
              <select
                value={selectedSchema}
                onChange={(e) => setSelectedSchema(e.target.value)}
                disabled={!selectedCatalog}
                className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#D0A33C] disabled:opacity-50"
              >
                <option value="">{selectedCatalog ? 'Select a schema...' : 'Choose a catalog first'}</option>
                {schemas.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Preview */}
          {selectedCatalog && schemaName && (
            <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)]">
              <p className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                Tables will be created at
              </p>
              <div className="flex flex-wrap gap-1.5">
                {selectedIndustry?.tables.map((t) => (
                  <span key={t} className="text-xs font-mono text-[var(--text-primary)]">
                    {selectedCatalog}.{schemaName}.{t}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-between pt-4">
            <button
              onClick={() => setStep('industry')}
              className="px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Back
            </button>
            <button
              onClick={() => setStep('config')}
              disabled={!canProceedLocation}
              className="px-5 py-2.5 rounded-lg bg-[#D0A33C] hover:bg-[#b88d2e] text-white text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next: Configure
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Date Range & Row Count */}
      {step === 'config' && (
        <div className="space-y-5">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Configure data parameters</h3>
          <p className="text-sm text-[var(--text-secondary)]">
            Set the date range and approximate number of rows for the generated data.
          </p>

          {/* Summary card */}
          <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] space-y-2">
            <div className="flex items-center gap-2">
              <IndustryIcon className="w-4 h-4 text-[#D0A33C]" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">{selectedIndustry?.label}</span>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              {selectedIndustry?.tables.length} tables in <span className="font-mono">{selectedCatalog}.{schemaName}</span>
            </p>
          </div>

          {/* Date range */}
          <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
              <Calendar className="w-3.5 h-3.5 inline mr-1" /> Date Range
            </label>
            <div className="flex items-center gap-3">
              <input
                type="date"
                value={dateStart}
                onChange={(e) => setDateStart(e.target.value)}
                className="flex-1 px-3 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#D0A33C]"
              />
              <span className="text-sm text-[var(--text-secondary)]">to</span>
              <input
                type="date"
                value={dateEnd}
                onChange={(e) => setDateEnd(e.target.value)}
                className="flex-1 px-3 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#D0A33C]"
              />
            </div>
          </div>

          {/* Row count */}
          <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
              <Hash className="w-3.5 h-3.5 inline mr-1" /> Rows per Table (approximate)
            </label>
            <div className="flex items-center gap-3">
              {[100, 500, 1000, 5000, 10000].map((n) => (
                <button
                  key={n}
                  onClick={() => setRowCount(n)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    rowCount === n
                      ? 'bg-[#D0A33C]/15 text-[#D0A33C] border border-[#D0A33C]/30'
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border)] hover:border-[var(--text-secondary)]'
                  }`}
                >
                  {n.toLocaleString()}
                </button>
              ))}
            </div>
            <input
              type="number"
              value={rowCount}
              onChange={(e) => setRowCount(Math.max(10, Math.min(100000, parseInt(e.target.value) || 100)))}
              className="mt-2 w-32 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#D0A33C]"
              min={10}
              max={100000}
            />
          </div>

          {/* Final summary */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-[#D0A33C]/5 to-[#3F1F14]/5 border border-[#D0A33C]/15">
            <p className="text-xs font-semibold text-[var(--text-primary)] mb-2">Summary</p>
            <ul className="space-y-1 text-xs text-[var(--text-secondary)]">
              <li><span className="text-[#D0A33C] mr-1">&#x2022;</span> Industry: <span className="text-[var(--text-primary)] font-medium">{selectedIndustry?.label}</span></li>
              <li><span className="text-[#D0A33C] mr-1">&#x2022;</span> Location: <span className="font-mono text-[var(--text-primary)]">{selectedCatalog}.{schemaName}</span></li>
              <li><span className="text-[#D0A33C] mr-1">&#x2022;</span> Tables: <span className="text-[var(--text-primary)] font-medium">{selectedIndustry?.tables.join(', ')}</span></li>
              <li><span className="text-[#D0A33C] mr-1">&#x2022;</span> Date range: <span className="text-[var(--text-primary)]">{dateStart} to {dateEnd}</span></li>
              <li><span className="text-[#D0A33C] mr-1">&#x2022;</span> ~{rowCount.toLocaleString()} rows per table</li>
            </ul>
          </div>

          <div className="flex justify-between pt-4">
            <button
              onClick={() => setStep('location')}
              className="px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Back
            </button>
            <button
              onClick={() => setStep('descriptions')}
              className="px-5 py-2.5 rounded-lg bg-[#D0A33C] hover:bg-[#b88d2e] text-white text-sm font-medium transition-colors"
            >
              Next: Metadata
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Descriptions / Metadata */}
      {step === 'descriptions' && (
        <div className="space-y-5">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Table & column descriptions</h3>
          <p className="text-sm text-[var(--text-secondary)]">
            Genie Rooms work best when tables and columns have descriptive metadata. You can choose to auto-generate
            descriptions using AI, or skip this and add them later.
          </p>

          <div className="space-y-3">
            {/* Option: Skip descriptions */}
            <button
              onClick={() => setIncludeDescriptions(false)}
              className={`w-full text-left p-4 rounded-xl border transition-all ${
                !includeDescriptions
                  ? 'bg-[var(--bg-secondary)] border-[#D0A33C]/40 shadow-md'
                  : 'bg-[var(--bg-secondary)] border-[var(--border)] hover:border-[var(--text-secondary)]'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 shrink-0 ${
                  !includeDescriptions ? 'border-[#D0A33C] bg-[#D0A33C]' : 'border-[var(--border)]'
                }`}>
                  {!includeDescriptions && <Check className="w-3 h-3 text-white" />}
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Skip descriptions</p>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                    Tables will be created without comments or column descriptions.
                    You can add them later from the Catalog Explorer.
                  </p>
                </div>
              </div>
            </button>

            {/* Option: Include descriptions */}
            <button
              onClick={() => setIncludeDescriptions(true)}
              className={`w-full text-left p-4 rounded-xl border transition-all ${
                includeDescriptions
                  ? 'bg-[var(--bg-secondary)] border-[#D0A33C]/40 shadow-md'
                  : 'bg-[var(--bg-secondary)] border-[var(--border)] hover:border-[var(--text-secondary)]'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 shrink-0 ${
                  includeDescriptions ? 'border-[#D0A33C] bg-[#D0A33C]' : 'border-[var(--border)]'
                }`}>
                  {includeDescriptions && <Check className="w-3 h-3 text-white" />}
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    Auto-generate descriptions
                    <span className="ml-2 text-[10px] font-medium text-[#D0A33C] bg-[#D0A33C]/10 px-1.5 py-0.5 rounded uppercase">Recommended</span>
                  </p>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                    AI will generate table comments and column descriptions after creating each table.
                    This makes the data immediately ready for Genie Rooms.
                  </p>
                  {includeDescriptions && (
                    <div className="mt-3 p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)]">
                      <p className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">What gets generated</p>
                      <ul className="space-y-1 text-[11px] text-[var(--text-secondary)]">
                        <li className="flex items-center gap-1.5">
                          <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                          Table-level COMMENT describing the purpose of each table
                        </li>
                        <li className="flex items-center gap-1.5">
                          <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                          Column-level COMMENT for every column with data type context
                        </li>
                        <li className="flex items-center gap-1.5">
                          <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                          Relationship hints between tables (e.g. foreign keys)
                        </li>
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </button>
          </div>

          {/* Final summary */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-[#D0A33C]/5 to-[#3F1F14]/5 border border-[#D0A33C]/15">
            <p className="text-xs font-semibold text-[var(--text-primary)] mb-2">Summary</p>
            <ul className="space-y-1 text-xs text-[var(--text-secondary)]">
              <li><span className="text-[#D0A33C] mr-1">&#x2022;</span> Industry: <span className="text-[var(--text-primary)] font-medium">{selectedIndustry?.label}</span></li>
              <li><span className="text-[#D0A33C] mr-1">&#x2022;</span> Location: <span className="font-mono text-[var(--text-primary)]">{selectedCatalog}.{schemaName}</span></li>
              <li><span className="text-[#D0A33C] mr-1">&#x2022;</span> Tables: <span className="text-[var(--text-primary)] font-medium">{selectedIndustry?.tables.join(', ')}</span></li>
              <li><span className="text-[#D0A33C] mr-1">&#x2022;</span> Date range: <span className="text-[var(--text-primary)]">{dateStart} to {dateEnd}</span></li>
              <li><span className="text-[#D0A33C] mr-1">&#x2022;</span> ~{rowCount.toLocaleString()} rows per table</li>
              <li><span className="text-[#D0A33C] mr-1">&#x2022;</span> Descriptions: <span className="text-[var(--text-primary)] font-medium">{includeDescriptions ? 'Auto-generated' : 'None (add later)'}</span></li>
            </ul>
          </div>

          <div className="flex justify-between pt-4">
            <button
              onClick={() => setStep('config')}
              className="px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleGenerate}
              className="px-5 py-2.5 rounded-lg bg-[#D0A33C] hover:bg-[#b88d2e] text-white text-sm font-medium transition-colors flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              Generate {selectedIndustry?.tables.length} Tables
            </button>
          </div>
        </div>
      )}

      {/* Step 5: Generation Progress */}
      {step === 'generate' && (
        <div className="space-y-5">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">
            {generating ? 'Generating tables...' : 'Generation complete'}
          </h3>
          <p className="text-sm text-[var(--text-secondary)]">
            {generating
              ? `Creating ${selectedIndustry?.label} tables in ${selectedCatalog}.${schemaName}`
              : `Finished creating tables in ${selectedCatalog}.${schemaName}`}
          </p>

          <div className="space-y-2">
            {selectedIndustry?.tables.map((tableName) => {
              const result = tableResults.find((r) => r.table === tableName)
              const isCurrentlyGenerating = currentTable === tableName && !result
              const isPending = !result && currentTable !== tableName

              return (
                <div
                  key={tableName}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                    result?.status === 'COMPLETED'
                      ? 'bg-emerald-500/5 border-emerald-500/20'
                      : result?.status === 'FAILED'
                        ? 'bg-red-500/5 border-red-500/20'
                        : isCurrentlyGenerating
                          ? 'bg-[#D0A33C]/5 border-[#D0A33C]/20'
                          : 'bg-[var(--bg-secondary)] border-[var(--border)]'
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0">
                    {result?.status === 'COMPLETED' ? (
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                        <Check className="w-4 h-4 text-emerald-600" />
                      </div>
                    ) : result?.status === 'FAILED' ? (
                      <div className="w-8 h-8 rounded-lg bg-red-500/15 flex items-center justify-center">
                        <X className="w-4 h-4 text-red-500" />
                      </div>
                    ) : isCurrentlyGenerating ? (
                      <div className="w-8 h-8 rounded-lg bg-[#D0A33C]/15 flex items-center justify-center">
                        <Loader2 className="w-4 h-4 text-[#D0A33C] animate-spin" />
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center">
                        <Table2 className="w-4 h-4 text-[var(--text-secondary)] opacity-40" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${
                      isPending ? 'text-[var(--text-secondary)] opacity-50' : 'text-[var(--text-primary)]'
                    }`}>
                      {tableName}
                    </p>
                    <p className="text-[10px] font-mono text-[var(--text-secondary)]">
                      {selectedCatalog}.{schemaName}.{tableName}
                    </p>
                  </div>
                  <div className="shrink-0">
                    {result?.status === 'COMPLETED' && (
                      <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-500/10 px-2 py-1 rounded uppercase">Done</span>
                    )}
                    {result?.status === 'PARTIAL' && (
                      <span className="text-[10px] font-semibold text-amber-600 bg-amber-500/10 px-2 py-1 rounded uppercase">Partial</span>
                    )}
                    {result?.status === 'FAILED' && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-semibold text-red-500 bg-red-500/10 px-2 py-1 rounded uppercase">Failed</span>
                        <button
                          onClick={() => retryTable(tableName)}
                          disabled={generating}
                          className="text-[10px] font-semibold text-[#D0A33C] bg-[#D0A33C]/10 px-2 py-1 rounded hover:bg-[#D0A33C]/20 transition-colors disabled:opacity-50"
                        >
                          Retry
                        </button>
                      </div>
                    )}
                    {isCurrentlyGenerating && (
                      <span className="text-[10px] font-semibold text-[#D0A33C] bg-[#D0A33C]/10 px-2 py-1 rounded uppercase">Generating...</span>
                    )}
                    {isPending && (
                      <span className="text-[10px] font-medium text-[var(--text-secondary)] opacity-40">Pending</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Error details */}
          {tableResults.some((r) => r.error) && (
            <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                <span className="text-xs font-semibold text-red-500">Errors</span>
              </div>
              {tableResults
                .filter((r) => r.error)
                .map((r) => (
                  <p key={r.table} className="text-xs text-red-400 mt-1">
                    {r.table}: {r.error}
                  </p>
                ))}
            </div>
          )}

          {!generating && (
            <div className="space-y-4 pt-4">
              {/* Success summary */}
              <div className="flex items-center gap-2 text-sm text-emerald-600">
                <Check className="w-4 h-4" />
                {tableResults.filter((r) => r.status === 'COMPLETED').length} of{' '}
                {selectedIndustry?.tables.length} tables created
                {tableResults.every((r) => r.status === 'COMPLETED') && (
                  <span className="text-[var(--text-secondary)]">
                    in <span className="font-mono">{selectedCatalog}.{schemaName}</span>
                  </span>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => navigate('/')}
                  className="flex-1 py-2.5 rounded-lg bg-[#D0A33C] hover:bg-[#b88d2e] text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  Done
                </button>
                <button
                  onClick={() => navigate('/create')}
                  className="py-2.5 px-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-sm text-[var(--text-primary)] hover:border-[#D0A33C]/40 transition-colors"
                >
                  Create Genie Room
                </button>
                <button
                  onClick={() => {
                    setStep('industry')
                    setTableResults([])
                    setSelectedIndustry(null)
                    setSelectedCatalog('')
                    setSelectedSchema('')
                    setNewSchemaName('')
                    setCreateNewSchema(false)
                  }}
                  className="py-2.5 px-4 rounded-lg bg-[var(--bg-tertiary)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  Generate More
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
