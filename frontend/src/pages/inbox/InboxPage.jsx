import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Send, Mail, MailOpen, RefreshCw, Inbox, MessageSquare } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

export default function InboxPage() {
  const queryClient = useQueryClient()
  const [filterAccountId, setFilterAccountId] = useState('')
  const [selectedPageId, setSelectedPageId] = useState(null)
  const [selectedMsg, setSelectedMsg] = useState(null)
  const [reply, setReply] = useState('')
  const messagesEndRef = useRef(null)

  // Load accounts
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounts').then(r => r.data),
  })

  // Load all fanpages
  const { data: allPages = [], isLoading: pagesLoading } = useQuery({
    queryKey: ['fanpages'],
    queryFn: () => api.get('/fanpages').then(r => r.data),
  })

  // Filter pages by account
  const pages = filterAccountId ? allPages.filter(p => p.account_id === filterAccountId) : allPages

  // Auto-select first page when filter changes
  useEffect(() => {
    if (pages.length > 0 && !pages.find(p => p.id === selectedPageId)) {
      setSelectedPageId(pages[0].id)
      setSelectedMsg(null)
    } else if (pages.length === 0) {
      setSelectedPageId(null)
      setSelectedMsg(null)
    }
  }, [filterAccountId, pages.length])

  // Load messages for selected page
  const { data: messages = [], isLoading: messagesLoading } = useQuery({
    queryKey: ['inbox', selectedPageId],
    queryFn: () => api.get(`/fanpages/${selectedPageId}/inbox`).then(r => r.data),
    enabled: !!selectedPageId,
    refetchInterval: 30000,
  })

  const markReadMutation = useMutation({
    mutationFn: (messageId) => api.post(`/fanpages/${selectedPageId}/mark-read`, { message_id: messageId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inbox', selectedPageId] }),
  })

  const replyMutation = useMutation({
    mutationFn: (data) => api.post(`/fanpages/${selectedPageId}/reply`, data),
    onSuccess: () => {
      setReply('')
      queryClient.invalidateQueries({ queryKey: ['inbox', selectedPageId] })
      toast.success('Đã gửi trả lời')
    },
    onError: () => toast.error('Gửi trả lời thất bại'),
  })

  const fetchInboxMutation = useMutation({
    mutationFn: () => api.post(`/fanpages/${selectedPageId}/fetch-inbox`),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['inbox', selectedPageId] })
      toast.success(`Đã tải ${res.data.fetched} tin nhắn mới`)
    },
    onError: () => toast.error('Không thể tải hộp thư'),
  })

  useEffect(() => {
    if (selectedMsg && !selectedMsg.is_read) {
      markReadMutation.mutate(selectedMsg.id)
    }
  }, [selectedMsg?.id])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selectedMsg])

  const handleSendReply = () => {
    if (!reply.trim() || !selectedMsg) return
    replyMutation.mutate({
      message_id: selectedMsg.id,
      sender_id: selectedMsg.sender_id,
      text: reply,
    })
  }

  const handleSelectPage = (pageId) => {
    setSelectedPageId(pageId)
    setSelectedMsg(null)
    setReply('')
  }

  const formatTime = (dateStr) => {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    const now = new Date()
    const diff = now - d
    if (diff < 60000) return 'Vừa xong'
    if (diff < 3600000) return `${Math.floor(diff / 60000)} phút`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} giờ`
    return d.toLocaleDateString('vi')
  }

  const selectedPage = pages.find(p => p.id === selectedPageId)

  if (pagesLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  if (pages.length === 0) {
    return (
      <div className="text-center py-16">
        <Inbox size={48} className="mx-auto mb-4 text-app-dim" />
        <h2 className="text-lg font-semibold text-app-primary mb-2">Chưa có fanpage nào</h2>
        <p className="text-sm text-app-dim">Thêm fanpage trước để sử dụng hộp thư</p>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-120px)]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-app-primary">Hộp thư</h1>
          <select
            value={filterAccountId}
            onChange={e => setFilterAccountId(e.target.value)}
            className="border border-app-border rounded-lg px-3 py-1.5 text-sm bg-app-surface focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Tất cả nick ({allPages.length} page)</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>
                {a.username || a.fb_user_id} ({allPages.filter(p => p.account_id === a.id).length} page)
              </option>
            ))}
          </select>
        </div>
        {selectedPageId && (
          <button
            onClick={() => fetchInboxMutation.mutate()}
            disabled={fetchInboxMutation.isPending}
            className="flex items-center gap-2 bg-info text-white px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm"
          >
            <RefreshCw size={14} className={fetchInboxMutation.isPending ? 'animate-spin' : ''} />
            Tải tin mới
          </button>
        )}
      </div>

      <div className="flex gap-4 h-[calc(100%-60px)]">
        {/* Left: Page list + Message list */}
        <div className="w-80 flex flex-col shrink-0">
          {/* Page list grouped by account */}
          <div className="bg-app-surface rounded-t-xl  border-b overflow-y-auto max-h-48">
            {(() => {
              // Group pages by account
              const grouped = {}
              for (const page of pages) {
                const acct = page.accounts?.username || page.accounts?.fb_user_id || 'Khác'
                if (!grouped[acct]) grouped[acct] = []
                grouped[acct].push(page)
              }
              const groups = Object.entries(grouped)
              return groups.map(([acctName, acctPages]) => (
                <div key={acctName}>
                  {groups.length > 1 && (
                    <div className="px-3 py-1.5 text-xs font-semibold text-app-dim uppercase bg-app-base border-b">{acctName}</div>
                  )}
                  {acctPages.map(page => (
                    <button
                      key={page.id}
                      onClick={() => handleSelectPage(page.id)}
                      className={`w-full text-left px-3 py-2 text-sm border-b transition-colors ${
                        selectedPageId === page.id
                          ? 'bg-blue-50 text-info font-medium border-l-3 border-l-blue-500'
                          : 'text-app-primary hover:bg-app-base'
                      }`}
                    >
                      <span className="truncate block">{page.name || page.fb_page_id}</span>
                    </button>
                  ))}
                </div>
              ))
            })()}
          </div>

          {/* Message list */}
          <div className="bg-app-surface rounded-b-xl shadow flex-1 overflow-y-auto">
            {messagesLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin w-6 h-6 border-3 border-blue-500 border-t-transparent rounded-full" />
              </div>
            ) : messages.length === 0 ? (
              <div className="p-8 text-center">
                <MessageSquare size={32} className="mx-auto mb-2 text-app-dim" />
                <p className="text-sm text-app-dim">Chưa có tin nhắn</p>
              </div>
            ) : (
              messages.map(msg => (
                <button
                  key={msg.id}
                  onClick={() => setSelectedMsg(msg)}
                  className={`w-full text-left p-4 border-b hover:bg-blue-50 transition-colors ${
                    selectedMsg?.id === msg.id ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                  } ${!msg.is_read ? 'bg-blue-25' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {msg.is_read
                        ? <MailOpen size={14} className="text-app-dim shrink-0" />
                        : <Mail size={14} className="text-info shrink-0" />
                      }
                      <span className={`truncate ${!msg.is_read ? 'font-semibold text-app-primary' : 'text-app-primary'}`}>
                        {msg.sender_name || 'Không rõ'}
                      </span>
                    </div>
                    <span className="text-xs text-app-dim shrink-0">{formatTime(msg.created_at)}</span>
                  </div>
                  <p className={`text-sm mt-1 truncate ${!msg.is_read ? 'text-app-primary' : 'text-app-muted'}`}>
                    {msg.message || msg.snippet || 'Không có nội dung'}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right: Message detail */}
        <div className="flex-1 bg-app-surface rounded shadow overflow-hidden flex flex-col">
          {selectedMsg ? (
            <>
              <div className="p-4 border-b bg-app-base">
                <h3 className="font-semibold text-app-primary">{selectedMsg.sender_name || 'Không rõ'}</h3>
                <p className="text-xs text-app-muted">
                  {selectedPage && <span className="text-info">{selectedPage.name}</span>}
                  {selectedMsg.sender_id && <span className="font-mono ml-2">ID: {selectedMsg.sender_id}</span>}
                  {selectedMsg.created_at && <span className="ml-3">{new Date(selectedMsg.created_at).toLocaleString('vi')}</span>}
                </p>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="bg-app-elevated rounded-lg p-4 max-w-[80%]">
                  <p className="text-sm text-app-primary whitespace-pre-wrap">{selectedMsg.message}</p>
                  <span className="text-xs text-app-dim mt-2 block">{formatTime(selectedMsg.created_at)}</span>
                </div>

                {selectedMsg.replies?.map((r, i) => (
                  <div key={i} className={`rounded-lg p-4 max-w-[80%] ${r.from === 'page' ? 'bg-blue-100 ml-auto' : 'bg-app-elevated'}`}>
                    <p className="text-sm whitespace-pre-wrap">{r.text}</p>
                    <span className="text-xs text-app-dim mt-2 block">{formatTime(r.created_at)}</span>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <div className="p-4 border-t">
                <div className="flex gap-2">
                  <textarea
                    value={reply}
                    onChange={e => setReply(e.target.value)}
                    placeholder="Nhập trả lời..."
                    rows={2}
                    className="flex-1 border rounded-lg px-3 py-2 resize-none text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendReply() } }}
                  />
                  <button
                    onClick={handleSendReply}
                    disabled={replyMutation.isPending || !reply.trim()}
                    className="bg-info text-white px-4 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                  >
                    <Send size={16} />
                    {replyMutation.isPending ? 'Đang gửi...' : 'Gửi'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-app-dim">
              <div className="text-center">
                <Mail size={48} className="mx-auto mb-3 text-app-dim" />
                <p>Chọn tin nhắn để xem</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
