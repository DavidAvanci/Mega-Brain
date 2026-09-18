import { useRef, useState, type PointerEvent } from 'react'

export function usePanScroll<T extends HTMLElement>() {
  const start = useRef<{
    x: number
    y: number
    left: number
    top: number
    verticalTarget: HTMLElement
  } | null>(null)
  const [panning, setPanning] = useState(false)

  const verticalScrollTarget = (target: EventTarget | null, root: T) => {
    let element = target instanceof HTMLElement ? target : null

    while (element && element !== root) {
      const { overflowY } = window.getComputedStyle(element)
      if (
        (overflowY === 'auto' || overflowY === 'scroll')
        && element.scrollHeight > element.clientHeight
      ) {
        return element
      }
      element = element.parentElement
    }

    return root
  }

  const stop = () => {
    start.current = null
    setPanning(false)
  }

  return {
    panning,
    handlers: {
      onPointerDown(e: PointerEvent<T>) {
        if (e.button !== 0) return
        if ((e.target as Element).closest('button, input, textarea, select, a, [role="button"]')) return
        const verticalTarget = verticalScrollTarget(e.target, e.currentTarget)
        start.current = {
          x: e.clientX,
          y: e.clientY,
          left: e.currentTarget.scrollLeft,
          top: verticalTarget.scrollTop,
          verticalTarget,
        }
        e.currentTarget.setPointerCapture(e.pointerId)
        setPanning(true)
      },
      onPointerMove(e: PointerEvent<T>) {
        if (!start.current) return
        e.currentTarget.scrollLeft = start.current.left - (e.clientX - start.current.x)
        start.current.verticalTarget.scrollTop = start.current.top - (e.clientY - start.current.y)
      },
      onPointerUp: stop,
      onPointerCancel: stop,
    },
  }
}
