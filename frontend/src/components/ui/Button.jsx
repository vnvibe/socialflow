/**
 * Standard Button — FRONTEND_REDESIGN.md step 9.
 *
 * Variants:
 *   primary   — main CTA, hermes green-cyan on black text
 *   secondary — neutral, elevated surface with border
 *   danger    — destructive action (delete / pause), red tint
 *   ghost     — inline/link style, muted text
 *
 * Sizes: sm (py-1 px-2), md (py-2 px-3), lg (py-2.5 px-4)
 *
 * Pass-through: any other props (type, onClick, disabled, title…) forward to <button>.
 * className prop is appended to the variant classes so callers can override spacing.
 */
export default function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  style = {},
  children,
  ...rest
}) {
  const variants = {
    primary: {
      className: 'font-semibold',
      style: { background: 'var(--hermes)', color: '#000' },
    },
    secondary: {
      className: 'text-app-primary',
      style: { background: 'var(--bg-elevated)', border: '1px solid var(--border)' },
    },
    danger: {
      className: 'text-danger',
      style: { background: 'rgba(248, 113, 113, 0.1)', border: '1px solid rgba(248, 113, 113, 0.3)' },
    },
    ghost: {
      className: 'text-app-muted hover:text-app-primary',
      style: { background: 'transparent' },
    },
  }
  const sizes = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-2 text-sm',
    lg: 'px-4 py-2.5 text-sm',
  }
  const v = variants[variant] || variants.secondary
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 ${sizes[size] || sizes.md} ${v.className} ${className}`}
      style={{ borderRadius: 4, ...v.style, ...style }}
    >
      {children}
    </button>
  )
}
