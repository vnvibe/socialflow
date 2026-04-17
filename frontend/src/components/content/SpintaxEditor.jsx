import { useState, useCallback } from 'react'
import { Eye, EyeOff, Shuffle } from 'lucide-react'

function resolveSpintax(text) {
  return text.replace(/\{([^{}]+)\}/g, (_, group) => {
    const options = group.split('|')
    return options[Math.floor(Math.random() * options.length)]
  })
}

function highlightSpintax(text) {
  const parts = []
  let lastIndex = 0
  const regex = /\{([^{}]+)\}/g
  let match

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={`t-${lastIndex}`}>
          {text.slice(lastIndex, match.index)}
        </span>
      )
    }
    parts.push(
      <span
        key={`s-${match.index}`}
        className="bg-blue-100 text-blue-700 rounded px-0.5"
      >
        {match[0]}
      </span>
    )
    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex)}</span>)
  }

  return parts
}

export default function SpintaxEditor({ value, onChange, rows = 6, placeholder }) {
  const [showPreview, setShowPreview] = useState(false)
  const [previewText, setPreviewText] = useState('')

  const handlePreview = useCallback(() => {
    if (!showPreview) {
      setPreviewText(resolveSpintax(value || ''))
    }
    setShowPreview((prev) => !prev)
  }, [showPreview, value])

  const handleRespin = useCallback(() => {
    setPreviewText(resolveSpintax(value || ''))
  }, [value])

  return (
    <div className="space-y-2">
      <div className="relative">
        <textarea
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder || 'Enter text with {option1|option2} spintax syntax...'}
          className="w-full rounded-lg border border-app-border px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y font-mono"
        />
      </div>

      {/* Highlighted preview of spintax tokens */}
      {value && (
        <div className="text-sm text-app-muted leading-relaxed p-3 bg-app-base rounded-lg whitespace-pre-wrap">
          {highlightSpintax(value)}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handlePreview}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-app-elevated text-app-primary hover:bg-app-hover transition-colors"
        >
          {showPreview ? (
            <EyeOff className="w-3.5 h-3.5" />
          ) : (
            <Eye className="w-3.5 h-3.5" />
          )}
          {showPreview ? 'Hide Preview' : 'Preview'}
        </button>

        {showPreview && (
          <button
            type="button"
            onClick={handleRespin}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
          >
            <Shuffle className="w-3.5 h-3.5" />
            Respin
          </button>
        )}
      </div>

      {/* Resolved preview */}
      {showPreview && (
        <div className="p-4 bg-app-surface border border-app-border rounded-lg">
          <p className="text-xs font-medium text-app-muted mb-1">
            Resolved Preview
          </p>
          <p className="text-sm text-app-primary whitespace-pre-wrap">
            {previewText || '(empty)'}
          </p>
        </div>
      )}
    </div>
  )
}
