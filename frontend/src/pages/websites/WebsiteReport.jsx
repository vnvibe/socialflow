import { useState, useMemo, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Calendar, Search, FileText, TrendingUp, TrendingDown,
  Loader, AlertTriangle, CheckCircle, Lightbulb, Info,
  ExternalLink, Sparkles, BarChart3, MousePointerClick, Eye, Target,
  ArrowUpDown, RefreshCw, HelpCircle, Award, Zap, ArrowRight
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

function formatNum(n) { return n != null ? n.toLocaleString('vi-VN') : '—' }
function formatPct(n) { return n != null ? (n * 100).toFixed(1) + '%' : '—' }
function formatPos(n) { return n != null ? n.toFixed(1) : '—' }

const PRESETS = [
  { label: '7 ngày', days: 7 },
  { label: '28 ngày', days: 28 },
  { label: '3 tháng', days: 90 },
  { label: '6 tháng', days: 180 },
]

function monthRange(monthsAgo) {
  const d = new Date()
  d.setMonth(d.getMonth() - monthsAgo)
  const start = new Date(d.getFullYear(), d.getMonth(), 1)
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] }
}

function quarterRange(qAgo) {
  const d = new Date()
  const curQ = Math.floor(d.getMonth() / 3)
  const targetQ = curQ - qAgo
  const y = d.getFullYear() + Math.floor(targetQ / 4) * (targetQ < 0 ? 1 : 0)
  const q = ((targetQ % 4) + 4) % 4
  const start = new Date(d.getFullYear(), (curQ - qAgo) * 3, 1)
  const end = new Date(start.getFullYear(), start.getMonth() + 3, 0)
  return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] }
}

// ─── Tooltip ───────────────────────────────────────────────────────────────────

function Tip({ text }) {
  return (
    <span className="group relative inline-flex ml-1 cursor-help">
      <HelpCircle size={12} className="text-gray-300 group-hover:text-blue-400 transition-colors" />
      <span className="invisible group-hover:visible absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 text-xs text-white bg-gray-800 rounded-lg shadow-lg w-56 text-center z-50 leading-relaxed">
        {text}
        <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 w-2 h-2 bg-gray-800 rotate-45" />
      </span>
    </span>
  )
}

// ─── Stat Card (enhanced) ──────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, compareValue, format = 'number', color = 'blue', description, invertChange = false }) {
  const colorMap = {
    blue: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-100' },
    green: { bg: 'bg-green-50', text: 'text-green-600', border: 'border-green-100' },
    purple: { bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-100' },
    orange: { bg: 'bg-orange-50', text: 'text-orange-600', border: 'border-orange-100' },
  }
  const c = colorMap[color]

  const displayValue = format === 'number' ? formatNum(value) : format === 'percent' ? formatPct(value) : formatPos(value)

  let change = null
  if (compareValue != null && value != null && compareValue > 0) {
    const pct = ((value - compareValue) / compareValue) * 100
    const isGood = invertChange ? pct <= 0 : pct >= 0
    change = { pct, isGood }
  }

  return (
    <div className={`bg-white rounded-xl border ${c.border} p-4 hover:shadow-sm transition-shadow`}>
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.bg} ${c.text}`}>
          <Icon size={16} />
        </div>
        <span className="text-xs text-gray-500 font-medium">{label}</span>
      </div>
      <div className="flex items-end gap-2 mt-2">
        <span className="text-2xl font-bold text-gray-900">{displayValue}</span>
        {change && (
          <span className={`text-xs font-semibold flex items-center gap-0.5 mb-1 px-1.5 py-0.5 rounded-full ${
            change.isGood ? 'text-green-700 bg-green-50' : 'text-red-600 bg-red-50'
          }`}>
            {change.isGood ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {Math.abs(change.pct).toFixed(1)}%
          </span>
        )}
      </div>
      {description && <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">{description}</p>}
    </div>
  )
}

// ─── Position Badge ────────────────────────────────────────────────────────────

function PosBadge({ value }) {
  const v = Number(value)
  const config = v <= 3 ? { bg: 'bg-green-100', text: 'text-green-700', label: 'Top 3 🔥' }
    : v <= 10 ? { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Trang 1' }
    : v <= 20 ? { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Trang 2' }
    : v <= 30 ? { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Trang 3' }
    : { bg: 'bg-gray-100', text: 'text-gray-600', label: '' }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
      {v.toFixed(1)} {config.label && <span className="text-[10px] opacity-70">{config.label}</span>}
    </span>
  )
}

// ─── CTR Bar ───────────────────────────────────────────────────────────────────

function CTRBar({ value }) {
  const pct = (value * 100)
  const width = Math.min(pct * 3, 100) // scale for visibility
  const color = pct >= 5 ? 'bg-green-400' : pct >= 2 ? 'bg-blue-400' : pct >= 1 ? 'bg-yellow-400' : 'bg-gray-300'
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
      </div>
      <span className="text-xs text-gray-600 w-10 text-right">{pct.toFixed(1)}%</span>
    </div>
  )
}

// ─── Data Table (enhanced) ─────────────────────────────────────────────────────

function DataTable({ data, columns, searchKey, searchPlaceholder, emptyText = 'Không có dữ liệu', emptyIcon: EmptyIcon = Search, maxRows = 30, description }) {
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('desc')
  const [showAll, setShowAll] = useState(false)

  const filtered = useMemo(() => {
    let rows = data || []
    if (search && searchKey) {
      const q = search.toLowerCase()
      rows = rows.filter(r => String(r[searchKey]).toLowerCase().includes(q))
    }
    if (sortCol) {
      rows = [...rows].sort((a, b) => {
        const av = a[sortCol] ?? 0, bv = b[sortCol] ?? 0
        return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
      })
    }
    return rows
  }, [data, search, searchKey, sortCol, sortDir])

  const visible = showAll ? filtered : filtered.slice(0, maxRows)

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  return (
    <div>
      {description && <p className="text-xs text-gray-400 mb-3 leading-relaxed">{description}</p>}
      {searchKey && (
        <div className="mb-3 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={searchPlaceholder || 'Tìm kiếm...'}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-gray-50/50"
          />
        </div>
      )}
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              {columns.map(col => (
                <th
                  key={col.key}
                  onClick={() => col.sortable !== false && toggleSort(col.key)}
                  className={`py-2.5 px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider ${col.sortable !== false ? 'cursor-pointer hover:text-gray-600 select-none' : ''} ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.tip && <Tip text={col.tip} />}
                    {sortCol === col.key && (
                      <ArrowUpDown size={10} className={sortDir === 'asc' ? 'text-blue-500 rotate-180' : 'text-blue-500'} />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-12">
                  <EmptyIcon size={28} className="mx-auto text-gray-200 mb-2" />
                  <p className="text-gray-400 text-sm">{emptyText}</p>
                </td>
              </tr>
            ) : visible.map((row, i) => (
              <tr key={i} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                {columns.map(col => (
                  <td key={col.key} className={`py-3 px-3 ${col.align === 'right' ? 'text-right' : ''}`}>
                    {col.render ? col.render(row[col.key], row, i) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > maxRows && !showAll && (
        <div className="mt-3 text-center">
          <button onClick={() => setShowAll(true)} className="text-xs text-blue-600 hover:text-blue-800 font-medium bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors">
            Xem tất cả {filtered.length} kết quả
          </button>
        </div>
      )}
      {filtered.length > 0 && (
        <p className="text-[10px] text-gray-300 mt-2 text-right">
          Hiển thị {visible.length}/{filtered.length} kết quả • Nhấn tiêu đề cột để sắp xếp
        </p>
      )}
    </div>
  )
}

// ─── AI Analysis Panel ─────────────────────────────────────────────────────────

function AIAnalysisPanel({ websiteId, startDate, endDate }) {
  const analysisMutation = useMutation({
    mutationFn: () => api.post(`/websites/${websiteId}/ai-analysis`, { startDate, endDate }).then(r => r.data),
    onError: (e) => toast.error(e.response?.data?.error || 'Lỗi phân tích AI'),
  })

  const text = analysisMutation.data?.analysis

  // Simple markdown to HTML (headings, bold, lists, emojis)
  const renderMarkdown = (md) => {
    if (!md) return null
    const lines = md.split('\n')
    const elements = []
    let inList = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) { if (inList) { inList = false }; elements.push(<div key={i} className="h-2" />); continue }

      if (line.startsWith('## ')) {
        elements.push(<h3 key={i} className="text-base font-bold text-gray-900 mt-4 mb-2 flex items-center gap-2">{line.slice(3)}</h3>)
      } else if (line.startsWith('### ')) {
        elements.push(<h4 key={i} className="text-sm font-semibold text-gray-800 mt-3 mb-1">{line.slice(4)}</h4>)
      } else if (line.startsWith('- ')) {
        const content = line.slice(2).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        elements.push(
          <div key={i} className="flex items-start gap-2 text-sm text-gray-700 leading-relaxed py-0.5 pl-2">
            <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-gray-400" />
            <span dangerouslySetInnerHTML={{ __html: content }} />
          </div>
        )
      } else {
        const content = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        elements.push(<p key={i} className="text-sm text-gray-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: content }} />)
      }
    }
    return elements
  }

  return (
    <div className="space-y-4">
      {/* CTA */}
      <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl border border-purple-100 p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-white shadow-sm flex items-center justify-center shrink-0">
            <Sparkles size={22} className="text-purple-500" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900 mb-1">Phân tích SEO bằng AI</h3>
            <p className="text-sm text-gray-600 leading-relaxed mb-3">
              AI sẽ phân tích từ khoá, trang, hiệu suất và đưa ra <strong>báo cáo + đề xuất cải thiện cụ thể</strong>.
            </p>
            <button
              onClick={() => analysisMutation.mutate()}
              disabled={analysisMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 text-sm font-medium shadow-sm transition-all hover:shadow"
            >
              {analysisMutation.isPending ? <Loader size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {analysisMutation.isPending ? 'Đang phân tích...' : text ? 'Phân tích lại' : 'Bắt đầu phân tích'}
            </button>
          </div>
        </div>
      </div>

      {analysisMutation.isPending && (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <Loader size={32} className="animate-spin mx-auto mb-3 text-purple-400" />
          <p className="text-sm text-gray-500 font-medium">AI đang phân tích dữ liệu...</p>
          <p className="text-xs text-gray-400 mt-1">Khoảng 10-30 giây</p>
        </div>
      )}

      {text && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          {renderMarkdown(text)}
        </div>
      )}
    </div>
  )
}

// ─── Comparison Tab ────────────────────────────────────────────────────────────

function ComparisonTab({ websiteId, startDate, endDate }) {
  const [dim, setDim] = useState('page')
  const [period, setPeriod] = useState('prev') // prev = same length before | month | quarter

  const days = Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000)
  const compareStart = daysAgo(days * 2)
  const compareEnd = daysAgo(days + 1)

  const compareQuery = useQuery({
    queryKey: ['gsc-compare', websiteId, startDate, endDate, dim],
    queryFn: () => api.post(`/websites/${websiteId}/gsc-compare`, {
      startDate, endDate,
      compareStartDate: compareStart, compareEndDate: compareEnd,
      dimension: dim,
    }).then(r => r.data),
    staleTime: 10 * 60 * 1000,
  })

  const rows = compareQuery.data?.rows || []
  const gainers = rows.filter(r => r.clicksDelta > 0).slice(0, 15)
  const losers = [...rows].filter(r => r.clicksDelta < 0).sort((a, b) => a.clicksDelta - b.clicksDelta).slice(0, 15)
  const newItems = rows.filter(r => r.prevClicks === 0 && r.clicks > 0).slice(0, 10)
  const lostItems = rows.filter(r => r.clicks === 0 && r.prevClicks > 0).slice(0, 10)

  const renderRow = (r, i, showDelta = true) => {
    let display = r.key
    if (dim === 'page') { try { display = new URL(r.key).pathname || '/' } catch {} }
    return (
      <div key={i} className="flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-gray-50 text-xs border-b border-gray-50 last:border-0">
        <span className="w-4 text-gray-400 text-right shrink-0">{i + 1}</span>
        <span className="flex-1 text-gray-800 font-medium truncate" title={r.key}>{display}</span>
        <span className="text-blue-600 font-semibold">{r.clicks}</span>
        {showDelta && (
          <span className={`font-semibold text-xs px-1.5 py-0.5 rounded ${
            r.clicksDelta > 0 ? 'text-green-700 bg-green-50' : r.clicksDelta < 0 ? 'text-red-600 bg-red-50' : 'text-gray-500 bg-gray-50'
          }`}>
            {r.clicksDelta > 0 ? '+' : ''}{r.clicksDelta}
          </span>
        )}
        {r.positionDelta !== 0 && (
          <span className={`text-[10px] ${r.positionDelta > 0 ? 'text-green-600' : 'text-red-500'}`}>
            {r.positionDelta > 0 ? '↑' : '↓'}{Math.abs(r.positionDelta).toFixed(1)}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">So sánh:</span>
        {[{ key: 'page', label: 'Trang' }, { key: 'query', label: 'Từ khoá' }].map(d => (
          <button key={d.key} onClick={() => setDim(d.key)}
            className={`px-3 py-1 rounded-lg text-xs font-medium ${dim === d.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >{d.label}</button>
        ))}
        <span className="text-xs text-gray-300 ml-2">vs {days} ngày trước</span>
      </div>

      {compareQuery.isLoading ? (
        <div className="text-center py-12 text-gray-400"><Loader size={18} className="animate-spin inline mr-2" />Đang so sánh...</div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          {/* Gainers */}
          <div className="bg-white rounded-xl border border-green-200 p-4">
            <h3 className="text-sm font-semibold text-green-700 mb-2 flex items-center gap-1.5">
              <TrendingUp size={14} /> Tăng trưởng
              <span className="text-xs bg-green-50 px-1.5 py-0.5 rounded-full">{gainers.length}</span>
            </h3>
            <p className="text-[10px] text-gray-400 mb-2">{dim === 'page' ? 'Trang' : 'Từ khoá'} có clicks tăng so với kỳ trước</p>
            {gainers.length === 0 ? (
              <p className="text-center py-6 text-gray-400 text-xs">Không có {dim === 'page' ? 'trang' : 'từ khoá'} nào tăng</p>
            ) : gainers.map((r, i) => renderRow(r, i))}
          </div>

          {/* Losers */}
          <div className="bg-white rounded-xl border border-red-200 p-4">
            <h3 className="text-sm font-semibold text-red-600 mb-2 flex items-center gap-1.5">
              <TrendingDown size={14} /> Giảm sút
              <span className="text-xs bg-red-50 px-1.5 py-0.5 rounded-full">{losers.length}</span>
            </h3>
            <p className="text-[10px] text-gray-400 mb-2">{dim === 'page' ? 'Trang' : 'Từ khoá'} có clicks giảm — cần kiểm tra</p>
            {losers.length === 0 ? (
              <p className="text-center py-6 text-gray-400 text-xs">Không có {dim === 'page' ? 'trang' : 'từ khoá'} nào giảm</p>
            ) : losers.map((r, i) => renderRow(r, i))}
          </div>

          {/* New items */}
          {newItems.length > 0 && (
            <div className="bg-white rounded-xl border border-blue-200 p-4">
              <h3 className="text-sm font-semibold text-blue-700 mb-2 flex items-center gap-1.5">
                <Zap size={14} /> Mới xuất hiện
                <span className="text-xs bg-blue-50 px-1.5 py-0.5 rounded-full">{newItems.length}</span>
              </h3>
              <p className="text-[10px] text-gray-400 mb-2">{dim === 'page' ? 'Trang' : 'Từ khoá'} mới có traffic kỳ này (kỳ trước = 0)</p>
              {newItems.map((r, i) => renderRow(r, i, false))}
            </div>
          )}

          {/* Lost items */}
          {lostItems.length > 0 && (
            <div className="bg-white rounded-xl border border-orange-200 p-4">
              <h3 className="text-sm font-semibold text-orange-700 mb-2 flex items-center gap-1.5">
                <AlertTriangle size={14} /> Mất traffic
                <span className="text-xs bg-orange-50 px-1.5 py-0.5 rounded-full">{lostItems.length}</span>
              </h3>
              <p className="text-[10px] text-gray-400 mb-2">{dim === 'page' ? 'Trang' : 'Từ khoá'} kỳ trước có clicks nhưng kỳ này = 0</p>
              {lostItems.map((r, i) => (
                <div key={i} className="flex items-center gap-2 py-2 px-2 text-xs border-b border-gray-50 last:border-0">
                  <span className="w-4 text-gray-400 text-right shrink-0">{i + 1}</span>
                  <span className="flex-1 text-gray-500 truncate">{dim === 'page' ? (() => { try { return new URL(r.key).pathname } catch { return r.key } })() : r.key}</span>
                  <span className="text-red-500 font-medium">-{r.prevClicks}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Detail Panel (drill-down into a page or keyword) ──────────────────────────

function DetailPanel({ websiteId, type, value, startDate, endDate, onClose }) {
  // type: 'page' → show keywords for this page | 'keyword' → show pages for this keyword
  const isPage = type === 'page'
  const filterDimension = isPage ? 'page' : 'query'
  const resultDimension = isPage ? 'query' : 'page'

  const detailQuery = useQuery({
    queryKey: ['gsc-detail', websiteId, type, value, startDate, endDate],
    queryFn: () => api.post(`/websites/${websiteId}/gsc-query`, {
      startDate, endDate,
      dimensions: [resultDimension],
      rowLimit: 200,
      dimensionFilterGroups: [{
        filters: [{ dimension: filterDimension, expression: value, operator: 'equals' }],
      }],
    }).then(r => r.data),
    staleTime: 10 * 60 * 1000,
  })

  // Also get total metrics for this page/keyword
  const totalsQuery = useQuery({
    queryKey: ['gsc-detail-totals', websiteId, type, value, startDate, endDate],
    queryFn: () => api.post(`/websites/${websiteId}/gsc-query`, {
      startDate, endDate,
      dimensions: ['date'],
      rowLimit: 500,
      dimensionFilterGroups: [{
        filters: [{ dimension: filterDimension, expression: value, operator: 'equals' }],
      }],
    }).then(r => r.data),
    staleTime: 10 * 60 * 1000,
  })

  const totals = useMemo(() => {
    if (!totalsQuery.data?.rows) return null
    const t = { clicks: 0, impressions: 0, ctr: 0, position: 0 }
    for (const r of totalsQuery.data.rows) { t.clicks += r.clicks; t.impressions += r.impressions }
    t.ctr = t.impressions > 0 ? t.clicks / t.impressions : 0
    t.position = totalsQuery.data.rows.length > 0
      ? totalsQuery.data.rows.reduce((s, r) => s + r.position, 0) / totalsQuery.data.rows.length : 0
    return t
  }, [totalsQuery.data])

  const rows = useMemo(() => {
    const raw = (detailQuery.data?.rows || []).map(r => ({
      key: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
    }))
    // Deduplicate: merge rows with same key (GSC can return duplicates for sc-domain properties)
    const map = new Map()
    for (const r of raw) {
      const k = r.key.replace(/\/$/, '').toLowerCase() // normalize trailing slash + case
      if (map.has(k)) {
        const existing = map.get(k)
        existing.clicks += r.clicks
        existing.impressions += r.impressions
        // weighted average position
        existing.position = (existing.position * existing._count + r.position) / (existing._count + 1)
        existing._count++
        existing.ctr = existing.impressions > 0 ? existing.clicks / existing.impressions : 0
      } else {
        map.set(k, { ...r, _count: 1 })
      }
    }
    return [...map.values()].map(({ _count, ...r }) => r).sort((a, b) => b.clicks - a.clicks)
  }, [detailQuery.data])

  let displayValue = value
  try { if (isPage) displayValue = new URL(value).pathname || '/' } catch {}

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-xl bg-white h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 z-10">
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${
              isPage ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {isPage ? '📄 Chi tiết trang' : '🔍 Chi tiết từ khoá'}
            </span>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <h2 className="text-lg font-bold text-gray-900 truncate" title={value}>{displayValue}</h2>
          {isPage && (
            <a href={value} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline inline-flex items-center gap-1 mt-0.5">
              {value} <ExternalLink size={10} />
            </a>
          )}
        </div>

        {/* Stats */}
        {totals && (
          <div className="grid grid-cols-4 gap-2 p-4 border-b border-gray-100">
            <div className="text-center">
              <div className="text-lg font-bold text-blue-600">{formatNum(totals.clicks)}</div>
              <div className="text-[10px] text-gray-400 uppercase">Clicks</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-purple-600">{formatNum(totals.impressions)}</div>
              <div className="text-[10px] text-gray-400 uppercase">Hiển thị</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-green-600">{formatPct(totals.ctr)}</div>
              <div className="text-[10px] text-gray-400 uppercase">CTR</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-orange-600">{formatPos(totals.position)}</div>
              <div className="text-[10px] text-gray-400 uppercase">Vị trí TB</div>
            </div>
          </div>
        )}

        {/* Related items */}
        <div className="p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-2">
            {isPage ? (
              <><Search size={14} className="text-blue-500" /> Từ khoá dẫn đến trang này</>
            ) : (
              <><FileText size={14} className="text-green-500" /> Các trang xếp hạng cho từ khoá này</>
            )}
            {rows.length > 0 && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{rows.length}</span>}
          </h3>
          <p className="text-[11px] text-gray-400 mb-3">
            {isPage
              ? 'Người dùng tìm gì trên Google để đến trang này? Từ khoá nào mang lại nhiều traffic nhất?'
              : 'Trang nào trên website đang xếp hạng cho từ khoá này? Trang nào cần tối ưu thêm?'}
          </p>

          {detailQuery.isLoading ? (
            <div className="text-center py-12 text-gray-400">
              <Loader size={20} className="animate-spin inline mr-2" /> Đang tải...
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Search size={28} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">Không có dữ liệu</p>
            </div>
          ) : (
            <div className="space-y-1">
              {rows.map((r, i) => {
                let display = r.key
                if (!isPage) { try { display = new URL(r.key).pathname || '/' } catch {} }
                return (
                  <div key={i} className="flex items-center gap-2 py-2.5 px-3 rounded-lg hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0">
                    <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-[10px] font-bold shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate" title={r.key}>{display}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-[11px] text-blue-600 font-semibold">{r.clicks} clicks</span>
                        <span className="text-[11px] text-gray-400">{formatNum(r.impressions)} hiển thị</span>
                        <CTRBar value={r.ctr} />
                      </div>
                    </div>
                    <PosBadge value={r.position} />
                  </div>
                )
              })}
            </div>
          )}

          {/* Insights for this item */}
          {rows.length > 0 && (
            <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
              <h4 className="text-xs font-semibold text-blue-800 mb-1.5 flex items-center gap-1">
                <Lightbulb size={12} /> Gợi ý
              </h4>
              <div className="space-y-1 text-xs text-blue-700 leading-relaxed">
                {isPage && rows.filter(r => r.position <= 10 && r.ctr < 0.03).length > 0 && (
                  <p>⚠️ Có <strong>{rows.filter(r => r.position <= 10 && r.ctr < 0.03).length}</strong> từ khoá trang 1 nhưng CTR thấp — nên tối ưu title/meta description.</p>
                )}
                {isPage && rows.filter(r => r.position > 10 && r.position <= 20 && r.impressions > 30).length > 0 && (
                  <p>🎯 <strong>{rows.filter(r => r.position > 10 && r.position <= 20 && r.impressions > 30).length}</strong> từ khoá sắp lên trang 1 (vị trí 10-20) — cơ hội tốt nếu tối ưu nội dung.</p>
                )}
                {!isPage && rows.length > 1 && (
                  <p>📄 Có <strong>{rows.length}</strong> trang cạnh tranh cho từ khoá này. Nên chọn 1 trang chính và redirect/canonical các trang còn lại.</p>
                )}
                {!isPage && rows.length === 1 && (
                  <p>✅ Chỉ 1 trang xếp hạng — không bị keyword cannibalization.</p>
                )}
                {totals && totals.position > 10 && totals.impressions > 100 && (
                  <p>📈 Nhiều impressions ({formatNum(totals.impressions)}) nhưng vị trí {formatPos(totals.position)} — nếu lên trang 1 sẽ tăng traffic đáng kể.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Report Page ──────────────────────────────────────────────────────────

export default function WebsiteReport() {
  const { id } = useParams()
  const [preset, setPreset] = useState(1)
  const [customRange, setCustomRange] = useState(null)
  const [tab, setTab] = useState('overview')
  const [detail, setDetail] = useState(null) // { type: 'page'|'keyword', value: '...' }

  const days = PRESETS[preset]?.days || 28
  const startDate = customRange?.start || daysAgo(days)
  const endDate = customRange?.end || daysAgo(0)
  const compareStart = customRange ? null : daysAgo(days * 2)
  const compareEnd = customRange ? null : daysAgo(days + 1)

  const qc = useQueryClient()

  const { data: websites = [] } = useQuery({
    queryKey: ['websites'],
    queryFn: () => api.get('/websites').then(r => r.data),
  })
  const website = websites.find(w => w.id === id)

  const STALE = 10 * 60 * 1000 // 10 min cache — GSC data doesn't change fast

  const overviewQuery = useQuery({
    queryKey: ['gsc-overview', id, startDate, endDate],
    queryFn: () => api.post(`/websites/${id}/gsc-overview`, {
      startDate, endDate,
      compareStartDate: compareStart,
      compareEndDate: compareEnd,
    }).then(r => r.data),
    enabled: !!id,
    staleTime: STALE,
    retry: 2,
  })

  // Prefetch keywords + pages as soon as overview loads (don't wait for tab click)
  useEffect(() => {
    if (!overviewQuery.data || !id) return
    const prefetch = (key, dims) => {
      qc.prefetchQuery({
        queryKey: [key, id, startDate, endDate],
        queryFn: () => api.post(`/websites/${id}/gsc-query`, {
          startDate, endDate, dimensions: dims, rowLimit: 500,
        }).then(r => r.data),
        staleTime: STALE,
      })
    }
    prefetch('gsc-keywords', ['query'])
    prefetch('gsc-pages', ['page'])
  }, [overviewQuery.data, id, startDate, endDate, qc])

  const keywordsQuery = useQuery({
    queryKey: ['gsc-keywords', id, startDate, endDate],
    queryFn: () => api.post(`/websites/${id}/gsc-query`, {
      startDate, endDate, dimensions: ['query'], rowLimit: 500,
    }).then(r => r.data),
    enabled: tab === 'keywords' || !!overviewQuery.data, // also load when prefetched
    staleTime: STALE,
  })

  const pagesQuery = useQuery({
    queryKey: ['gsc-pages', id, startDate, endDate],
    queryFn: () => api.post(`/websites/${id}/gsc-query`, {
      startDate, endDate, dimensions: ['page'], rowLimit: 500,
    }).then(r => r.data),
    enabled: tab === 'pages' || !!overviewQuery.data,
    staleTime: STALE,
  })

  const ov = overviewQuery.data

  const keywordColumns = [
    { key: 'rank', label: '#', render: (_, __, i) => <span className="text-gray-400 text-xs font-mono">{i + 1}</span>, sortable: false },
    { key: 'query', label: 'Từ khoá', tip: 'Từ khoá mà người dùng tìm trên Google và thấy website của bạn. Nhấn để xem chi tiết.',
      render: (v) => (
        <button onClick={() => setDetail({ type: 'keyword', value: v })} className="font-medium text-gray-800 text-sm hover:text-blue-600 hover:underline text-left transition-colors">
          {v}
        </button>
      ) },
    { key: 'clicks', label: 'Clicks', align: 'right', tip: 'Số lần người dùng nhấn vào kết quả tìm kiếm',
      render: (v) => <span className="font-semibold text-blue-600">{formatNum(v)}</span> },
    { key: 'impressions', label: 'Hiển thị', align: 'right', tip: 'Số lần website xuất hiện trên kết quả tìm kiếm',
      render: (v) => <span className="text-gray-600">{formatNum(v)}</span> },
    { key: 'ctr', label: 'CTR', align: 'right', tip: 'Tỉ lệ nhấn = Clicks ÷ Hiển thị. CTR cao = tiêu đề hấp dẫn',
      render: (v) => <CTRBar value={v} /> },
    { key: 'position', label: 'Vị trí', align: 'right', tip: 'Thứ hạng trung bình trên Google. 1-3 = rất tốt, 4-10 = trang 1, >10 = trang 2+',
      render: (v) => <PosBadge value={v} /> },
  ]

  const pageColumns = [
    { key: 'rank', label: '#', render: (_, __, i) => <span className="text-gray-400 text-xs font-mono">{i + 1}</span>, sortable: false },
    { key: 'page', label: 'Trang', tip: 'Đường dẫn trang trên website. Nhấn để xem từ khoá liên quan.',
      render: (v) => {
        try {
          const u = new URL(v)
          return (
            <button onClick={() => setDetail({ type: 'page', value: v })} className="group flex items-center gap-1 max-w-[280px] text-left">
              <span className="text-blue-600 group-hover:underline text-sm font-medium truncate">{u.pathname || '/'}</span>
              <ArrowRight size={10} className="text-gray-300 group-hover:text-blue-400 shrink-0" />
            </button>
          )
        } catch { return <span className="text-xs truncate">{v}</span> }
      }
    },
    { key: 'clicks', label: 'Clicks', align: 'right', render: (v) => <span className="font-semibold text-blue-600">{formatNum(v)}</span> },
    { key: 'impressions', label: 'Hiển thị', align: 'right', render: (v) => <span className="text-gray-600">{formatNum(v)}</span> },
    { key: 'ctr', label: 'CTR', align: 'right', render: (v) => <CTRBar value={v} /> },
    { key: 'position', label: 'Vị trí TB', align: 'right', render: (v) => <PosBadge value={v} /> },
  ]

  const keywordRows = useMemo(() =>
    (keywordsQuery.data?.rows || []).map(r => ({
      query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
    })), [keywordsQuery.data])

  const pageRows = useMemo(() => {
    const raw = (pagesQuery.data?.rows || []).map(r => ({
      page: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
    }))
    // Deduplicate pages by normalized URL
    const map = new Map()
    for (const r of raw) {
      const k = r.page.replace(/\/$/, '').toLowerCase()
      if (map.has(k)) {
        const e = map.get(k)
        e.clicks += r.clicks; e.impressions += r.impressions
        e.position = (e.position * e._c + r.position) / (e._c + 1); e._c++
        e.ctr = e.impressions > 0 ? e.clicks / e.impressions : 0
      } else { map.set(k, { ...r, _c: 1 }) }
    }
    return [...map.values()].map(({ _c, ...r }) => r)
  }, [pagesQuery.data])

  // Quick stats for overview
  const quickInsights = useMemo(() => {
    if (!ov) return null
    const insights = []
    const tq = ov.topQueries || []
    const tp = ov.topPages || []
    const top3kw = tq.filter(q => q.position <= 3).length
    const page1kw = tq.filter(q => q.position <= 10).length
    const highCTR = tq.filter(q => q.ctr >= 0.05).length

    if (top3kw > 0) insights.push({ icon: '🏆', text: `${top3kw} từ khoá nằm trong Top 3 Google`, type: 'good' })
    if (page1kw > 0) insights.push({ icon: '✅', text: `${page1kw} từ khoá xuất hiện trang 1 Google`, type: 'good' })
    if (highCTR > 0) insights.push({ icon: '💡', text: `${highCTR} từ khoá có CTR > 5% (tốt!)`, type: 'good' })

    const lowCTRHigh = tq.filter(q => q.position <= 5 && q.ctr < 0.03)
    if (lowCTRHigh.length > 0) insights.push({ icon: '⚠️', text: `${lowCTRHigh.length} từ khoá top 5 nhưng CTR thấp — nên tối ưu tiêu đề`, type: 'warn' })

    const almostPage1 = tq.filter(q => q.position > 10 && q.position <= 15 && q.impressions > 50)
    if (almostPage1.length > 0) insights.push({ icon: '🎯', text: `${almostPage1.length} từ khoá sắp lên trang 1 (vị trí 10-15) — cơ hội tốt!`, type: 'opportunity' })

    return insights
  }, [ov])

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/settings/websites" className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900 truncate">{website?.name || 'Báo cáo Website'}</h1>
          {website?.url && (
            <a href={website.url} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline inline-flex items-center gap-1">
              {website.url} <ExternalLink size={10} />
            </a>
          )}
        </div>
      </div>

      {/* Date Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-400 font-medium mr-1">Khoảng thời gian:</span>
        {PRESETS.map((p, i) => (
          <button
            key={i}
            onClick={() => { setPreset(i); setCustomRange(null) }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              preset === i && !customRange
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100'
            }`}
          >
            {p.label}
          </button>
        ))}
        <div className="flex items-center gap-1.5 ml-auto">
          <Calendar size={13} className="text-gray-400" />
          <input
            type="date"
            value={customRange?.start || startDate}
            onChange={e => setCustomRange(prev => ({ start: e.target.value, end: prev?.end || endDate }))}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <span className="text-gray-300">→</span>
          <input
            type="date"
            value={customRange?.end || endDate}
            onChange={e => setCustomRange(prev => ({ start: prev?.start || startDate, end: e.target.value }))}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <button
            onClick={() => overviewQuery.refetch()}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            title="Làm mới"
          >
            <RefreshCw size={13} className={overviewQuery.isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Loading / Error */}
      {overviewQuery.isLoading ? (
        <div className="text-center py-16">
          <Loader className="animate-spin inline mr-2 text-blue-400" size={20} />
          <span className="text-gray-500">Đang tải dữ liệu từ Google Search Console...</span>
        </div>
      ) : overviewQuery.error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-700">Không thể tải dữ liệu</p>
              <p className="text-xs text-red-600 mt-1">{overviewQuery.error?.response?.data?.error || 'Lỗi kết nối'}</p>
              {overviewQuery.error?.response?.status === 404 && (
                <p className="text-xs text-red-500 mt-2 bg-red-100 p-2 rounded">
                  💡 Có thể API server chưa restart sau khi cập nhật. Hãy restart API server rồi thử lại.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Stats Cards */}
      {ov && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            icon={MousePointerClick} label="Tổng Clicks" color="blue"
            value={ov.totals.clicks} compareValue={ov.compareTotals?.clicks}
            description="Số lần người dùng nhấp vào website từ Google"
          />
          <StatCard
            icon={Eye} label="Lượt hiển thị" color="purple"
            value={ov.totals.impressions} compareValue={ov.compareTotals?.impressions}
            description="Số lần website xuất hiện trên kết quả tìm kiếm"
          />
          <StatCard
            icon={Target} label="CTR trung bình" format="percent" color="green"
            value={ov.totals.ctr} compareValue={ov.compareTotals?.ctr}
            description="Tỷ lệ nhấp: càng cao = tiêu đề hấp dẫn"
          />
          <StatCard
            icon={BarChart3} label="Vị trí TB" format="position" color="orange"
            value={ov.totals.position} compareValue={ov.compareTotals?.position}
            description="Vị trí trung bình trên Google (thấp = tốt)" invertChange
          />
        </div>
      )}

      {/* Quick Insights */}
      {quickInsights?.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <Zap size={14} className="text-yellow-500" /> Nhận xét nhanh
          </h3>
          <div className="grid sm:grid-cols-2 gap-2">
            {quickInsights.map((ins, i) => (
              <div key={i} className={`flex items-start gap-2 text-xs p-2.5 rounded-lg ${
                ins.type === 'good' ? 'bg-green-50 text-green-700' :
                ins.type === 'warn' ? 'bg-yellow-50 text-yellow-700' :
                'bg-blue-50 text-blue-700'
              }`}>
                <span className="shrink-0">{ins.icon}</span>
                <span className="leading-relaxed">{ins.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200 bg-white rounded-t-xl">
        {[
          { key: 'overview', label: 'Tổng quan', icon: BarChart3, desc: 'Top keywords & pages' },
          { key: 'keywords', label: 'Từ khoá', icon: Search, desc: 'Chi tiết từ khoá' },
          { key: 'pages', label: 'Trang', icon: FileText, desc: 'Chi tiết trang' },
          { key: 'compare', label: 'So sánh', icon: TrendingUp, desc: 'Tăng/giảm' },
          { key: 'ai', label: 'AI Đề xuất', icon: Sparkles, desc: 'Phân tích & đề xuất' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium border-b-2 transition-all ${
              tab === t.key
                ? 'text-blue-600 border-blue-600 bg-blue-50/50'
                : 'text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-50/50'
            }`}
          >
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'overview' && ov && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 text-sm mb-1 flex items-center gap-2">
              <Search size={14} className="text-blue-500" /> Top từ khoá
            </h3>
            <p className="text-[11px] text-gray-400 mb-3">Từ khoá mang lại nhiều clicks nhất</p>
            <div className="space-y-1">
              {(ov.topQueries || []).slice(0, 10).map((q, i) => (
                <button key={i} onClick={() => setDetail({ type: 'keyword', value: q.query })} className="w-full flex items-center gap-2 text-xs py-2 px-2 rounded-lg hover:bg-blue-50 transition-colors text-left">
                  <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-[10px] font-bold shrink-0">{i + 1}</span>
                  <span className="flex-1 text-gray-800 font-medium truncate">{q.query}</span>
                  <span className="text-blue-600 font-semibold">{q.clicks}</span>
                  <PosBadge value={q.position} />
                </button>
              ))}
              {(ov.topQueries || []).length === 0 && (
                <p className="text-center py-6 text-gray-400 text-xs">Chưa có dữ liệu từ khoá</p>
              )}
            </div>
            {(ov.topQueries || []).length > 0 && (
              <button onClick={() => setTab('keywords')} className="mt-3 text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1">
                Xem tất cả từ khoá <ArrowRight size={12} />
              </button>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 text-sm mb-1 flex items-center gap-2">
              <FileText size={14} className="text-green-500" /> Top trang
            </h3>
            <p className="text-[11px] text-gray-400 mb-3">Trang nhận được nhiều lượt truy cập nhất từ Google</p>
            <div className="space-y-1">
              {(ov.topPages || []).slice(0, 10).map((p, i) => {
                let path = p.page
                try { path = new URL(p.page).pathname } catch {}
                return (
                  <button key={i} onClick={() => setDetail({ type: 'page', value: p.page })} className="w-full flex items-center gap-2 text-xs py-2 px-2 rounded-lg hover:bg-green-50 transition-colors text-left">
                    <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-[10px] font-bold shrink-0">{i + 1}</span>
                    <span className="flex-1 text-gray-800 font-medium truncate" title={p.page}>{path || '/'}</span>
                    <span className="text-blue-600 font-semibold">{p.clicks}</span>
                    <span className="text-gray-400">{formatPct(p.ctr)}</span>
                  </button>
                )
              })}
              {(ov.topPages || []).length === 0 && (
                <p className="text-center py-6 text-gray-400 text-xs">Chưa có dữ liệu trang</p>
              )}
            </div>
            {(ov.topPages || []).length > 0 && (
              <button onClick={() => setTab('pages')} className="mt-3 text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1">
                Xem tất cả trang <ArrowRight size={12} />
              </button>
            )}
          </div>
        </div>
      )}

      {tab === 'keywords' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <Search size={15} className="text-blue-500" />
            Tất cả từ khoá
            {keywordRows.length > 0 && <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">{keywordRows.length}</span>}
          </h3>
          {keywordsQuery.isLoading ? (
            <div className="text-center py-12 text-gray-400"><Loader size={18} className="animate-spin inline mr-2" />Đang tải từ khoá...</div>
          ) : (
            <DataTable
              data={keywordRows}
              columns={keywordColumns}
              searchKey="query"
              searchPlaceholder="Tìm từ khoá..."
              description="Danh sách tất cả từ khoá mà website xuất hiện trên Google. Nhấn vào tiêu đề cột để sắp xếp theo clicks, vị trí..."
              emptyText="Chưa có dữ liệu. Hãy chờ Google thu thập dữ liệu."
            />
          )}
        </div>
      )}

      {tab === 'pages' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <FileText size={15} className="text-green-500" />
            Tất cả trang
            {pageRows.length > 0 && <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full font-medium">{pageRows.length}</span>}
          </h3>
          {pagesQuery.isLoading ? (
            <div className="text-center py-12 text-gray-400"><Loader size={18} className="animate-spin inline mr-2" />Đang tải trang...</div>
          ) : (
            <DataTable
              data={pageRows}
              columns={pageColumns}
              searchKey="page"
              searchPlaceholder="Tìm theo URL..."
              description="Các trang trên website và hiệu suất trên Google Search. Trang có nhiều impressions nhưng ít clicks = cần cải thiện tiêu đề/mô tả."
              emptyText="Chưa có dữ liệu trang."
              emptyIcon={FileText}
            />
          )}
        </div>
      )}

      {tab === 'compare' && (
        <ComparisonTab websiteId={id} startDate={startDate} endDate={endDate} />
      )}

      {tab === 'ai' && (
        <AIAnalysisPanel websiteId={id} startDate={startDate} endDate={endDate} />
      )}

      {/* Detail slide-out panel */}
      {detail && (
        <DetailPanel
          websiteId={id}
          type={detail.type}
          value={detail.value}
          startDate={startDate}
          endDate={endDate}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  )
}
