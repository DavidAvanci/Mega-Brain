import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { STATUS_GROUPS, STATUS_META } from '@/statusMeta'
import type { Card, Status } from '../../../shared/domain/cards'
import { minimapViewport, type ScrollMetrics } from '@/boardMinimapGeometry'

interface BoardMinimapProps {
  boardRef: RefObject<HTMLElement | null>
  cardsByStatus: ReadonlyMap<Status, Card[]>
}

const EMPTY_METRICS: ScrollMetrics = { clientWidth: 0, scrollLeft: 0, scrollWidth: 0 }
function sameMetrics(left: ScrollMetrics, right: ScrollMetrics) {
  return (
    left.clientWidth === right.clientWidth &&
    left.scrollLeft === right.scrollLeft &&
    left.scrollWidth === right.scrollWidth
  )
}

export function BoardMinimap({ boardRef, cardsByStatus }: BoardMinimapProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragOffset = useRef(0)
  const frame = useRef<number | null>(null)
  const [metrics, setMetrics] = useState(EMPTY_METRICS)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const board = boardRef.current
    if (!board) return

    const measure = () => {
      frame.current = null
      const next = {
        clientWidth: board.clientWidth,
        scrollLeft: board.scrollLeft,
        scrollWidth: board.scrollWidth,
      }
      setMetrics((current) => (sameMetrics(current, next) ? current : next))
    }
    const scheduleMeasure = () => {
      if (frame.current === null) frame.current = window.requestAnimationFrame(measure)
    }

    measure()
    board.addEventListener('scroll', scheduleMeasure, { passive: true })
    const resizeObserver = new ResizeObserver(scheduleMeasure)
    resizeObserver.observe(board)
    for (const child of board.children) resizeObserver.observe(child)

    return () => {
      board.removeEventListener('scroll', scheduleMeasure)
      resizeObserver.disconnect()
      if (frame.current !== null) window.cancelAnimationFrame(frame.current)
    }
  }, [boardRef])

  const scrollFromPointer = (clientX: number) => {
    const board = boardRef.current
    const track = trackRef.current
    if (!board || !track) return

    const bounds = track.getBoundingClientRect()
    const scrollRange = board.scrollWidth - board.clientWidth
    const viewportWidth = bounds.width * (board.clientWidth / board.scrollWidth)
    const travel = bounds.width - viewportWidth
    if (scrollRange <= 0 || travel <= 0) return

    const requestedLeft = clientX - bounds.left - dragOffset.current
    const viewportLeft = Math.max(0, Math.min(travel, requestedLeft))
    board.scrollLeft = (viewportLeft / travel) * scrollRange
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const viewport = event.currentTarget.querySelector<HTMLElement>('[data-minimap-viewport]')
    const viewportBounds = viewport?.getBoundingClientRect()
    const insideViewport =
      viewportBounds && event.clientX >= viewportBounds.left && event.clientX <= viewportBounds.right

    dragOffset.current =
      insideViewport && viewportBounds ? event.clientX - viewportBounds.left : (viewportBounds?.width ?? 0) / 2
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    scrollFromPointer(event.clientX)
  }

  const stopDragging = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setDragging(false)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const board = boardRef.current
    if (!board) return

    const step = Math.max(96, board.clientWidth * 0.2)
    if (event.key === 'ArrowLeft') board.scrollBy({ left: -step, behavior: 'smooth' })
    else if (event.key === 'ArrowRight') board.scrollBy({ left: step, behavior: 'smooth' })
    else if (event.key === 'Home') board.scrollTo({ left: 0, behavior: 'smooth' })
    else if (event.key === 'End') board.scrollTo({ left: board.scrollWidth, behavior: 'smooth' })
    else return
    event.preventDefault()
  }

  if (metrics.scrollWidth <= metrics.clientWidth) return null

  const viewport = minimapViewport(metrics)
  const maxScroll = Math.max(0, metrics.scrollWidth - metrics.clientWidth)

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 hidden justify-center md:flex">
      <div
        ref={trackRef}
        role="scrollbar"
        tabIndex={0}
        aria-label="Navegação horizontal do quadro"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={Math.round(maxScroll)}
        aria-valuenow={Math.round(metrics.scrollLeft)}
        className={`group pointer-events-auto relative touch-none overflow-hidden border bg-muted/80 shadow-sm outline-none backdrop-blur-md transition-[width,height,padding,border-radius,box-shadow,opacity] duration-200 ease-out focus-visible:ring-2 focus-visible:ring-ring/50 ${dragging ? 'h-14 w-[clamp(16rem,38vw,32rem)] cursor-grabbing rounded-lg p-1 opacity-100 shadow-md' : 'h-2.5 w-28 cursor-grab rounded-[5px] p-0 opacity-65 hover:h-14 hover:w-[clamp(16rem,38vw,32rem)] hover:rounded-lg hover:p-1 hover:opacity-100 hover:shadow-md focus:h-14 focus:w-[clamp(16rem,38vw,32rem)] focus:rounded-lg focus:p-1 focus:opacity-100'}`}
        onPointerDown={onPointerDown}
        onPointerMove={(event) => {
          if (dragging) scrollFromPointer(event.clientX)
        }}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onKeyDown={onKeyDown}
      >
        <div
          aria-hidden="true"
          className={`flex h-full gap-1 transition-opacity duration-150 ${dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus:opacity-100'}`}
        >
          {STATUS_GROUPS.map(({ label, statuses }) => (
            <div key={label} className="flex min-w-0 gap-0.5" style={{ flex: statuses.length }}>
              {statuses.map((status) => {
                const cardCount = cardsByStatus.get(status)?.length ?? 0
                return (
                  <div key={status} className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-sm bg-background/80 p-0.5">
                    <span className={`h-1 shrink-0 rounded-[2px] opacity-80 ${STATUS_META[status].highlight}`} />
                    {Array.from({ length: Math.min(cardCount, 4) }, (_, index) => (
                      <span key={index} className="h-1.5 rounded-[2px] border bg-muted" />
                    ))}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <div
          data-minimap-viewport
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 border-primary transition-[border-radius,border-width,background-color] duration-200 ${dragging ? 'rounded-md border-2 bg-primary/10' : 'rounded-[5px] border bg-primary/35 group-hover:rounded-md group-hover:border-2 group-hover:bg-primary/10 group-focus:rounded-md group-focus:border-2 group-focus:bg-primary/10'}`}
          style={{ left: `${viewport.left}%`, width: `${viewport.width}%` }}
        />
      </div>
    </div>
  )
}
