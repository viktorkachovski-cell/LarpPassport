import { useEffect, useRef, useState } from 'react'

// Horizontal scroll region for dense editable tables. Named and focusable so
// keyboard users can scroll it; shows a cue only while it actually overflows.
export default function TableScroll({ label, children }) {
  const ref = useRef(null)
  const [overflows, setOverflows] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const check = () => setOverflows(el.scrollWidth > el.clientWidth + 1)
    check()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', check)
      return () => window.removeEventListener('resize', check)
    }
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [children])

  return (
    <div className={`table-scroll-wrap ${overflows ? 'overflowing' : ''}`}>
      <div className="table-scroll" role="region" aria-label={label} tabIndex={0} ref={ref}>
        {children}
      </div>
      {overflows && <p className="scroll-cue" aria-hidden="true">Scroll sideways for more columns →</p>}
    </div>
  )
}
