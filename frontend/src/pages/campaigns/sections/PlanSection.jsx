import { useState, useEffect, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Sparkles, Save, RotateCcw, Loader2, Clock, Info, RefreshCw, X, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../../lib/api'
import EditablePlanList, { buildPlanRows, applyRowsToPlan } from '../../../components/campaigns/EditablePlanList'

/**
 * Plan section — view & edit the AI plan for a running campaign.
 * Changes apply to next runs without recreating the campaign.
 */
export default function PlanSection({ campaign }) {
  const queryClient = useQueryClient()

  // Derive runs/day from cron (count comma-separated hours)
  const runsPerDay = useMemo(() => {
    const cron = campaign?.cron_expression || ''
    const parts = cron.split(' ')
    const hours = parts[1] || '*'
    if (hours === '*') return 24
    return hours.split(',').length || 1
  }, [campaign?.cron_expression])

  const [rows, setRows] = useState(() => buildPlanRows(campaign?.ai_plan, runsPerDay))
  const [dirty, setDirty] = useState(false)

  // Regenerate state
  const [showRegen, setShowRegen] = useState(false)
  const [regenMission, setRegenMission] = useState(campaign?.mission || campaign?.requirement || '')
  const [regenPlan, setRegenPlan] = useState(null)
  const [regenRows, setRegenRows] = useState([])

  // Reset rows when campaign data refreshes (and not currently editing)
  useEffect(() => {
    if (!dirty) {
      setRows(buildPlanRows(campaign?.ai_plan, runsPerDay))
    }
    if (!showRegen) {
      setRegenMission(campaign?.mission || campaign?.requirement || '')
    }
  }, [campaign?.ai_plan, campaign?.mission, campaign?.requirement, runsPerDay, dirty, showRegen])

  const handleChange = (newRows) => {
    setRows(newRows)
    setDirty(true)
  }

  const resetMut = () => {
    setRows(buildPlanRows(campaign?.ai_plan, runsPerDay))
    setDirty(false)
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      const newPlan = applyRowsToPlan(campaign.ai_plan, rows, runsPerDay)
      await api.put(`/campaigns/${campaign.id}/plan`, { ai_plan: newPlan })
      return newPlan
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign', campaign.id] })
      toast.success('Đã lưu kế hoạch — áp dụng cho lần chạy tiếp theo')
      setDirty(false)
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Lỗi lưu kế hoạch'),
  })

  // ── Regenerate AI plan ──
  const regenMut = useMutation({
    mutationFn: () => api.post('/campaigns/preview-plan', {
      mission: regenMission,
      topic: campaign?.topic,
      account_ids: campaign?.account_ids || [],
      runs_per_day: runsPerDay,
      brand_config: campaign?.brand_config || null,
    }).then(r => r.data),
    onSuccess: (data) => {
      setRegenPlan(data.plan)
      setRegenRows(buildPlanRows(data.plan, runsPerDay))
      toast.success('AI đã tạo kế hoạch mới — xem trước và xác nhận')
    },
    onError: (err) => toast.error(err.response?.data?.error || 'AI không thể tạo kế hoạch'),
  })

  const confirmRegenMut = useMutation({
    mutationFn: async () => {
      const finalPlan = applyRowsToPlan(regenPlan, regenRows, runsPerDay)
      // 1. Update mission + ai_plan on campaign row
      await api.put(`/campaigns/${campaign.id}`, {
        mission: regenMission,
        ai_plan: finalPlan,
        ai_plan_confirmed: true,
      })
      // 2. Cascade parsed_plan to campaign_roles (same endpoint used by the inline editor)
      await api.put(`/campaigns/${campaign.id}/plan`, { ai_plan: finalPlan })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign', campaign.id] })
      toast.success('Đã áp dụng kế hoạch mới')
      setShowRegen(false)
      setRegenPlan(null)
      setRegenRows([])
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Lỗi lưu'),
  })

  const cancelRegen = () => {
    setShowRegen(false)
    setRegenPlan(null)
    setRegenRows([])
    setRegenMission(campaign?.mission || campaign?.requirement || '')
  }

  if (!campaign?.ai_plan?.roles?.length) {
    return (
      <div className="bg-app-surface rounded border border-app-border p-8 text-center">
        <Sparkles className="w-10 h-10 text-app-dim mx-auto mb-3" />
        <p className="text-sm text-app-muted">Chiến dịch chưa có kế hoạch AI</p>
        <p className="text-xs text-app-dim mt-1">Vào tab Cài đặt để tạo kế hoạch</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-app-primary">Kế hoạch chiến dịch</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-app-muted flex items-center gap-1">
            <Clock size={12} /> {runsPerDay} lần chạy/ngày
          </span>
          <button
            onClick={() => setShowRegen(!showRegen)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700"
          >
            <RefreshCw size={12} /> Tạo lại kế hoạch
          </button>
        </div>
      </div>

      {/* ── Regenerate Panel ── */}
      {showRegen && (
        <div className="bg-app-surface rounded border-2 border-purple-300 overflow-hidden">
          <div className="px-5 py-3 bg-purple-50 border-b border-purple-200 flex items-center justify-between">
            <span className="text-sm font-semibold text-purple-800 flex items-center gap-2">
              <Sparkles size={14} /> Tạo lại kế hoạch AI
            </span>
            <button onClick={cancelRegen} className="text-app-dim hover:text-app-muted">
              <X size={16} />
            </button>
          </div>
          <div className="p-5 space-y-3">
            <div>
              <label className="text-xs font-medium text-app-muted mb-1 block">Mô tả mục tiêu (mission)</label>
              <textarea
                value={regenMission}
                onChange={e => { setRegenMission(e.target.value); setRegenPlan(null); setRegenRows([]) }}
                rows={4}
                placeholder="VD: Tìm 4-6 nhóm VPS mỗi ngày, tương tác tự nhiên..."
                className="w-full border border-app-border rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              />
            </div>

            {!regenPlan ? (
              <button
                onClick={() => regenMut.mutate()}
                disabled={!regenMission.trim() || regenMut.isPending}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  regenMission.trim() && !regenMut.isPending
                    ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700'
                    : 'bg-app-elevated text-app-dim cursor-not-allowed'
                }`}
              >
                {regenMut.isPending
                  ? <><Loader2 size={14} className="animate-spin" /> AI đang phân tích...</>
                  : <><Sparkles size={14} /> AI tạo kế hoạch</>}
              </button>
            ) : (
              <>
                <div className="border border-purple-200 rounded-lg overflow-hidden">
                  <EditablePlanList rows={regenRows} onChange={(r) => setRegenRows(r)} />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => regenMut.mutate()}
                    disabled={regenMut.isPending}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs text-purple-600 hover:text-purple-800"
                  >
                    <Sparkles size={12} /> Tạo lại
                  </button>
                  <button
                    onClick={() => confirmRegenMut.mutate()}
                    disabled={confirmRegenMut.isPending}
                    className="flex items-center gap-1.5 px-4 py-2 bg-hermes text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                  >
                    {confirmRegenMut.isPending
                      ? <><Loader2 size={14} className="animate-spin" /> Đang lưu...</>
                      : <><Check size={14} /> Xác nhận & áp dụng</>}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-start gap-2">
        <Info size={14} className="text-blue-600 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-700">
          Thay đổi áp dụng ngay cho các lần chạy tiếp theo mà không cần dừng/tạo lại chiến dịch.
          Cảnh báo đỏ = vượt giới hạn an toàn (FB có thể hạn chế nick).
        </p>
      </div>

      <div className="bg-app-surface rounded border-2 border-purple-200 overflow-hidden">
        <div className="px-5 py-3 bg-purple-50 border-b border-purple-100 flex items-center justify-between">
          <span className="text-sm font-semibold text-purple-800 flex items-center gap-2">
            <Sparkles size={14} /> Kế hoạch hiện tại
          </span>
          {dirty && (
            <span className="text-[11px] text-orange-600 font-medium">● Có thay đổi chưa lưu</span>
          )}
        </div>

        <EditablePlanList rows={rows} onChange={handleChange} />

        <div className="px-5 py-3 border-t border-app-border flex items-center justify-end gap-2">
          <button
            disabled={!dirty || saveMut.isPending}
            onClick={resetMut}
            className="flex items-center gap-1.5 px-3 py-2 text-xs text-app-muted hover:text-app-primary disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <RotateCcw size={12} /> Hoàn tác
          </button>
          <button
            disabled={!dirty || saveMut.isPending}
            onClick={() => saveMut.mutate()}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              dirty
                ? 'bg-info text-white hover:opacity-90'
                : 'bg-app-elevated text-app-dim cursor-not-allowed'
            }`}
          >
            {saveMut.isPending
              ? <><Loader2 size={14} className="animate-spin" /> Đang lưu...</>
              : <><Save size={14} /> Lưu kế hoạch</>}
          </button>
        </div>
      </div>
    </div>
  )
}
