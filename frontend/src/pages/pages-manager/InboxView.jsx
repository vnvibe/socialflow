import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Send, Mail, MailOpen, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

export default function InboxView() {
  const { id } = useParams()
  const queryClient = useQueryClient()
  const [selectedMsg, setSelectedMsg] = useState(null)
  const [reply, setReply] = useState('')
  const messagesEndRef = useRef(null)

  const { data: page } = useQuery({
    queryKey: ['fanpage', id],
    queryFn: () => api.get(`/fanpages/${id}`).then(r => r.data)
  })

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['inbox', id],
    queryFn: () => api.get(`/fanpages/${id}/inbox`).then(r => r.data),
    refetchInterval: 30000
  })

  const markReadMutation = useMutation({
    mutationFn: (messageId) => api.post(`/fanpages/${id}/mark-read`, { message_id: messageId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inbox', id] })
  })

  const replyMutation = useMutation({
    mutationFn: (data) => api.post(`/fanpages/${id}/reply`, data),
    onSuccess: () => {
      setReply('')
      queryClient.invalidateQueries({ queryKey: ['inbox', id] })
      toast.success('Reply sent')
    },
    onError: () => toast.error('Failed to send reply')
  })

  const fetchInboxMutation = useMutation({
    mutationFn: () => api.post(`/fanpages/${id}/fetch-inbox`),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['inbox', id] })
      toast.success(`Fetched ${res.data.fetched} messages`)
    },
    onError: () => toast.error('Failed to fetch inbox')
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
      text: reply
    })
  }

  const formatTime = (dateStr) => {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    const now = new Date()
    const diff = now - d
    if (diff < 60000) return 'Just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return d.toLocaleDateString()
  }

  if (isLoading) return <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link to="/pages" className="text-app-muted hover:text-app-primary"><ArrowLeft size={20} /></Link>
        <h1 className="text-2xl font-bold text-app-primary">Inbox — {page?.name || 'Page'}</h1>
        <button onClick={() => fetchInboxMutation.mutate()} disabled={fetchInboxMutation.isPending} className="ml-auto flex items-center gap-2 bg-info text-white px-4 py-2 rounded-lg hover:opacity-90">
          <RefreshCw size={16} className={fetchInboxMutation.isPending ? 'animate-spin' : ''} /> Fetch New
        </button>
      </div>

      <div className="flex gap-4 h-[calc(100vh-180px)]">
        {/* Left panel - message list */}
        <div className="w-1/3 bg-app-surface rounded shadow overflow-hidden flex flex-col">
          <div className="p-3 border-b bg-app-base">
            <span className="text-sm text-app-muted">{messages.length} conversations</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {messages.length === 0 && (
              <div className="p-8 text-center text-app-dim">No messages yet</div>
            )}
            {messages.map(msg => (
              <button
                key={msg.id}
                onClick={() => setSelectedMsg(msg)}
                className={`w-full text-left p-4 border-b hover:bg-blue-50 transition-colors ${
                  selectedMsg?.id === msg.id ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                } ${!msg.is_read ? 'bg-blue-25' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {msg.is_read ? <MailOpen size={14} className="text-app-dim shrink-0" /> : <Mail size={14} className="text-info shrink-0" />}
                    <span className={`truncate ${!msg.is_read ? 'font-semibold text-app-primary' : 'text-app-primary'}`}>
                      {msg.sender_name || 'Unknown'}
                    </span>
                  </div>
                  <span className="text-xs text-app-dim shrink-0">{formatTime(msg.created_at)}</span>
                </div>
                <p className={`text-sm mt-1 truncate ${!msg.is_read ? 'text-app-primary' : 'text-app-muted'}`}>
                  {msg.message || msg.snippet || 'No preview'}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Right panel - message detail */}
        <div className="flex-1 bg-app-surface rounded shadow overflow-hidden flex flex-col">
          {selectedMsg ? (
            <>
              <div className="p-4 border-b bg-app-base">
                <h3 className="font-semibold text-app-primary">{selectedMsg.sender_name || 'Unknown'}</h3>
                <p className="text-xs text-app-muted">
                  {selectedMsg.sender_id && <span className="font-mono">ID: {selectedMsg.sender_id}</span>}
                  {selectedMsg.created_at && <span className="ml-3">{new Date(selectedMsg.created_at).toLocaleString()}</span>}
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
                    placeholder="Type your reply..."
                    rows={2}
                    className="flex-1 border rounded-lg px-3 py-2 resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendReply() } }}
                  />
                  <button
                    onClick={handleSendReply}
                    disabled={replyMutation.isPending || !reply.trim()}
                    className="bg-info text-white px-4 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                  >
                    <Send size={16} />
                    {replyMutation.isPending ? 'Sending...' : 'Send'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-app-dim">
              <div className="text-center">
                <Mail size={48} className="mx-auto mb-3 text-app-dim" />
                <p>Select a message to view</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
