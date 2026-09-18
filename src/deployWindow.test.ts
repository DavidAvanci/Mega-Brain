import { expect, test } from 'vitest'
import { deployWindow } from './deployWindow'

const brt = (iso: string) => new Date(`${iso}-03:00`)

test('deployWindow', () => {
  expect(deployWindow(brt('2026-08-18T10:00'))).toMatchObject({ open: true })
  expect(deployWindow(brt('2026-08-17T09:00'))).toMatchObject({ open: true })
  expect(deployWindow(brt('2026-08-17T15:59'))).toMatchObject({ open: true })

  expect(deployWindow(brt('2026-08-17T08:30'))).toEqual({ open: false, next: 'seg 09:00' })
  expect(deployWindow(brt('2026-08-17T12:00'))).toEqual({ open: false, next: 'seg 14:00' })
  expect(deployWindow(brt('2026-08-17T16:00'))).toEqual({ open: false, next: 'ter 09:00' })
  expect(deployWindow(brt('2026-08-18T16:36'))).toEqual({ open: false, next: 'qua 09:00' })
  expect(deployWindow(brt('2026-08-19T11:30'))).toEqual({ open: false, next: 'seg 09:00' })
  expect(deployWindow(brt('2026-08-21T10:00'))).toEqual({ open: false, next: 'seg 09:00' })
  expect(deployWindow(brt('2026-08-23T10:00'))).toEqual({ open: false, next: 'seg 09:00' })
})

test('nextDeploySlot', async () => {
  const { nextDeploySlot } = await import('./deployWindow')
  expect(nextDeploySlot(brt('2026-08-18T10:00'))).toMatchObject({ open: true })
  expect(nextDeploySlot(brt('2026-08-19T11:30'))).toEqual({ open: false, label: 'segunda 24/08/2026 09:00' })
  expect(nextDeploySlot(brt('2026-08-17T12:00'))).toEqual({ open: false, label: 'segunda 17/08/2026 14:00' })
})
