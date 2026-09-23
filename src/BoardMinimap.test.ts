import { describe, expect, it } from 'vitest'
import { minimapViewport } from './boardMinimapGeometry'

describe('minimapViewport', () => {
  it('maps the visible board area to percentages of the minimap', () => {
    expect(minimapViewport({ clientWidth: 800, scrollLeft: 400, scrollWidth: 2000 })).toEqual({
      left: 20,
      width: 40,
    })
  })

  it('fills the minimap when the board does not overflow', () => {
    expect(minimapViewport({ clientWidth: 1200, scrollLeft: 0, scrollWidth: 800 })).toEqual({
      left: 0,
      width: 100,
    })
  })

  it('handles an unmeasured board', () => {
    expect(minimapViewport({ clientWidth: 0, scrollLeft: 0, scrollWidth: 0 })).toEqual({
      left: 0,
      width: 100,
    })
  })
})
