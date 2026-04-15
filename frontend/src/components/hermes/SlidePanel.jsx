/**
 * SlidePanel — slide-out from right.
 * Usage: <SlidePanel open={x} onClose={...} title="..."><content/></SlidePanel>
 */
import { useEffect } from 'react'
import { X } from 'lucide-react'

export default function SlidePanel({ open, onClose, title, children, width = 480 }) {
  useEffect(() => {
    if (!open) return
    const handler = (e) => e.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
      />
      {/* Panel */}
      <div
        className="fixed top-0 right-0 bottom-0 z-50 bg-app-surface"
        style={{
          width: `${width}px`,
          borderLeft: '1px solid var(--border-bright)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
          animation: 'slide-in 0.2s ease-out',
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <span className="font-mono-ui text-sm uppercase tracking-wider text-app-primary">
            {title}
          </span>
          <button
            onClick={onClose}
            className="text-app-muted hover:text-app-primary p-1"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto" style={{ height: 'calc(100vh - 48px)' }}>
          {children}
        </div>
      </div>
      <style>{`
        @keyframes slide-in {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
    </>
  )
}
