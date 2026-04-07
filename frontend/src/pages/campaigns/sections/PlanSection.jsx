import { useState, useEffect, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Sparkles, Save, RotateCcw, Loader2, Clock, Info } from 'lucide-react'
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

  // Reset rows when campaign data refreshes (and not currently editing)
  useEffect(() => {
    if (!dirty) {
      setRows(buildPlanRows(campaign?.ai_plan, runsPerDay))
    }
  }, [campaign?.ai_plan, runsPerDay, dirty])

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

  if (!campaign?.ai_plan?.roles?.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <Sparkles className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p className="text-sm text-gray-500">Chiến dịch chưa có kế hoạch AI</p>
        <p className="text-xs text-gray-400 mt-1">Vào tab Cài đặt để tạo kế hoạch</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Kế hoạch chiến dịch</h2>
        <span className="text-xs text-gray-500 flex items-center gap-1">
          <Clock size={12} /> {runsPerDay} lần chạy/ngày
        </span>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-start gap-2">
        <Info size={14} className="text-blue-600 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-700">
          Thay đổi áp dụng ngay cho các lần chạy tiếp theo mà không cần dừng/tạo lại chiến dịch.
          Cảnh báo đỏ = vượt giới hạn an toàn (FB có thể hạn chế nick).
        </p>
      </div>

      <div className="bg-white rounded-xl border-2 border-purple-200 overflow-hidden">
        <div className="px-5 py-3 bg-purple-50 border-b border-purple-100 flex items-center justify-between">
          <span className="text-sm font-semibold text-purple-800 flex items-center gap-2">
            <Sparkles size={14} /> Kế hoạch hiện tại
          </span>
          {dirty && (
            <span className="text-[11px] text-orange-600 font-medium">● Có thay đổi chưa lưu</span>
          )}
        </div>

        <EditablePlanList rows={rows} onChange={handleChange} />

        <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-end gap-2">
          <button
            disabled={!dirty || saveMut.isPending}
            onClick={resetMut}
            className="flex items-center gap-1.5 px-3 py-2 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <RotateCcw size={12} /> Hoàn tác
          </button>
          <button
            disabled={!dirty || saveMut.isPending}
            onClick={() => saveMut.mutate()}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              dirty
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
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
