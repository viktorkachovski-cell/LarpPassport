import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAction } from './useAction'

describe('useAction', () => {
  it('runs one action at a time and reports its key while busy', async () => {
    const { result } = renderHook(() => useAction())
    let finish
    const action = vi.fn(() => new Promise((resolve) => { finish = resolve }))
    let first
    act(() => { first = result.current.run(action, { key: 'row-1', success: 'Saved.' }) })
    expect(result.current.busy).toBe('row-1')
    let second
    act(() => { second = result.current.run(action) })
    expect(await second).toBe(false)
    expect(action).toHaveBeenCalledOnce()
    await act(async () => { finish(); await first })
    expect(result.current.busy).toBe(false)
    expect(result.current.outcome).toEqual({ tone: 'ok', text: 'Saved.' })
  })

  it('turns a thrown failure into an error outcome and skips onSuccess', async () => {
    const { result } = renderHook(() => useAction())
    const onSuccess = vi.fn()
    await act(() => result.current.run(() => Promise.reject(new Error('permission denied')), {
      failure: (reason) => `Not sent: ${reason}`, onSuccess,
    }))
    expect(result.current.outcome).toEqual({ tone: 'error', text: 'Not sent: permission denied' })
    expect(onSuccess).not.toHaveBeenCalled()
    act(() => result.current.clear())
    expect(result.current.outcome).toBeNull()
  })
})
