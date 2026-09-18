export interface ScrollMetrics {
  clientWidth: number
  scrollLeft: number
  scrollWidth: number
}

export function minimapViewport(metrics: ScrollMetrics) {
  if (metrics.scrollWidth <= 0) return { left: 0, width: 100 }

  return {
    left: (metrics.scrollLeft / metrics.scrollWidth) * 100,
    width: Math.min(100, (metrics.clientWidth / metrics.scrollWidth) * 100),
  }
}
