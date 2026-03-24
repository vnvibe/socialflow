import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { Target, Plus, Save, ArrowLeft } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import RoleCard from './RoleCard'

const SCHEDULE_PRESETS = [
  { label: 'Hang ngay 9h', value: '0 9 * * *' },
  { label: 'Hang ngay 6h va 18h', value: '0 6,18 * * *' },
  { label: 'Ngay lam viec 8h', value: '0 8 * * 1-5' },
  { label: 'Moi 4 tieng', value: '0 */4 * * *' },
]

export default function CampaignForm() {
  const { id } = useParams()
  const isEdit = !!id
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [form, setForm] = useState({
    name: '', topic: '',
    schedule_type: 'recurring',
    cron_expression: '0 9 * * *',
    interval_minutes: 60,
    nick_stagger_seconds: 60,
    role_stagger_minutes: 30,
  })
  const [roles, setRoles] = useState([])
  const [parsingIdx, setParsingIdx] = useState(null)

  // Load accounts
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounts').then(r => r.data),
  })

  // Load existing campaign for edit
  const { data: existing } = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => api.get(`/campaigns/${id}`).then(r => r.data),
    enabled: isEdit,
  })

  useEffect(() => {
    if (existing) {
      setForm({
        name: existing.name || '',
        topic: existing.topic || '',
        schedule_type: existing.schedule_type || 'recurring',
        cron_expression: existing.cron_expression || '0 9 * * *',
        interval_minutes: existing.interval_minutes || 60,
        nick_stagger_seconds: existing.nick_stagger_seconds || 60,
        role_stagger_minutes: existing.role_stagger_minutes || 30,
      })
      setRoles((existing.campaign_roles || []).map(r => ({ ...r })))
    }
  }, [existing])

  // Create campaign
  const createMut = useMutation({
    mutationFn: async (data) => {
      const res = await api.post('/campaigns', data)
      const campaignId = res.data.id
      // Create roles
      for (const role of roles) {
        await api.post(`/campaigns/${campaignId}/roles`, {
          name: role.name,
          role_type: role.role_type || 'custom',
          account_ids: role.account_ids || [],
          mission: role.mission || '',
          config: role.config || {},
          sort_order: roles.indexOf(role),
          feeds_into: null, // TODO: resolve temp IDs
        })
      }
      return campaignId
    },
    onSuccess: (campaignId) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      toast.success('Da tao chien dich')
      navigate(`/campaigns/${campaignId}`)
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Loi tao chien dich'),
  })

  // Update campaign
  const updateMut = useMutation({
    mutationFn: async (data) => {
      await api.put(`/campaigns/${id}`, data)
      // Update roles
      for (const role of roles) {
        if (role.id) {
          await api.put(`/campaigns/${id}/roles/${role.id}`, {
            name: role.name,
            role_type: role.role_type,
            account_ids: role.account_ids,
            mission: role.mission,
            sort_order: roles.indexOf(role),
          })
        } else {
          await api.post(`/campaigns/${id}/roles`, {
            name: role.name,
            role_type: role.role_type || 'custom',
            account_ids: role.account_ids || [],
            mission: role.mission || '',
            sort_order: roles.indexOf(role),
          })
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      queryClient.invalidateQueries({ queryKey: ['campaign', id] })
      toast.success('Da cap nhat')
      navigate(`/campaigns/${id}`)
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Loi'),
  })

  const handleSubmit = () => {
    if (!form.name) return toast.error('Ten chien dich la bat buoc')
    if (!form.topic) return toast.error('Chu de la bat buoc')

    const data = { ...form }
    if (isEdit) updateMut.mutate(data)
    else createMut.mutate(data)
  }

  const addRole = () => {
    setRoles([...roles, {
      _tempId: `temp_${Date.now()}`,
      name: `Role ${roles.length + 1}`,
      role_type: roles.length === 0 ? 'scout' : roles.length === 1 ? 'nurture' : 'connect',
      account_ids: [],
      mission: '',
      parsed_plan: null,
    }])
  }

  const updateRole = (idx, updated) => {
    const newRoles = [...roles]
    newRoles[idx] = updated
    setRoles(newRoles)
  }

  const deleteRole = (idx) => {
    setRoles(roles.filter((_, i) => i !== idx))
  }

  const parseRole = async (idx) => {
    const role = roles[idx]
    if (!role.id || !isEdit) {
      toast.error('Luu chien dich truoc khi parse')
      return
    }
    setParsingIdx(idx)
    try {
      const res = await api.post(`/campaigns/${id}/roles/${role.id}/parse`)
      const newRoles = [...roles]
      newRoles[idx] = { ...newRoles[idx], parsed_plan: res.data.plan }
      setRoles(newRoles)
      // Save parsed_plan to DB
      await api.put(`/campaigns/${id}/roles/${role.id}`, { parsed_plan: res.data.plan })
      toast.success('AI da phan tich xong')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Loi parse')
    } finally {
      setParsingIdx(null)
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/campaigns')} className="p-1.5 text-gray-400 hover:text-gray-600">
          <ArrowLeft size={20} />
        </button>
        <Target size={24} className="text-blue-600" />
        <h1 className="text-2xl font-bold text-gray-900">
          {isEdit ? 'Sua Chien Dich' : 'Tao Chien Dich'}
        </h1>
      </div>

      <div className="space-y-6">
        {/* Basic Info */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-900">Thong tin co ban</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Ten chien dich *</label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="VD: VPS Growth Campaign" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Chu de *</label>
              <input type="text" value={form.topic} onChange={e => setForm({ ...form, topic: e.target.value })}
                placeholder="VD: vps, hosting, server" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          {/* Schedule */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Lich chay</label>
            <div className="flex items-center gap-3">
              <select value={form.schedule_type} onChange={e => setForm({ ...form, schedule_type: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="recurring">Lap lai (cron)</option>
                <option value="interval">Moi N phut</option>
                <option value="once">1 lan</option>
              </select>

              {form.schedule_type === 'recurring' && (
                <div className="flex items-center gap-2 flex-1">
                  <input type="text" value={form.cron_expression} onChange={e => setForm({ ...form, cron_expression: e.target.value })}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" />
                  <div className="flex gap-1">
                    {SCHEDULE_PRESETS.map(p => (
                      <button key={p.value} onClick={() => setForm({ ...form, cron_expression: p.value })}
                        className={`px-2 py-1 rounded text-[10px] ${form.cron_expression === p.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {form.schedule_type === 'interval' && (
                <div className="flex items-center gap-2">
                  <input type="number" value={form.interval_minutes} onChange={e => setForm({ ...form, interval_minutes: parseInt(e.target.value) })}
                    className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  <span className="text-sm text-gray-500">phut</span>
                </div>
              )}
            </div>
          </div>

          {/* Anti-detect config */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Delay giua nick (giay)</label>
              <input type="number" value={form.nick_stagger_seconds} onChange={e => setForm({ ...form, nick_stagger_seconds: parseInt(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Delay giua role (phut)</label>
              <input type="number" value={form.role_stagger_minutes} onChange={e => setForm({ ...form, role_stagger_minutes: parseInt(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
        </div>

        {/* Roles */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Roles ({roles.length})</h2>
            <button onClick={addRole} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100">
              <Plus size={14} /> Them Role
            </button>
          </div>

          {roles.length === 0 ? (
            <div className="text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-300">
              <p className="text-sm text-gray-400 mb-2">Chua co role nao</p>
              <button onClick={addRole} className="text-blue-600 hover:underline text-sm">Them role dau tien</button>
            </div>
          ) : (
            <div className="space-y-3">
              {roles.map((role, idx) => (
                <RoleCard
                  key={role.id || role._tempId}
                  role={role}
                  index={idx}
                  accounts={accounts}
                  otherRoles={roles.filter((_, i) => i !== idx)}
                  onUpdate={(updated) => updateRole(idx, updated)}
                  onDelete={deleteRole}
                  onParse={isEdit ? parseRole : null}
                  parsing={parsingIdx === idx}
                />
              ))}
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <button onClick={() => navigate('/campaigns')} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
            Huy
          </button>
          <button
            onClick={handleSubmit}
            disabled={createMut.isPending || updateMut.isPending}
            className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            <Save size={16} /> {isEdit ? 'Cap nhat' : 'Tao chien dich'}
          </button>
        </div>
      </div>
    </div>
  )
}
