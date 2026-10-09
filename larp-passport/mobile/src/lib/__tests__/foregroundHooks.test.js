let mockEffect
const mockSetState = jest.fn()
const mockListeners = new Set()
const mockAppState = {
  currentState: 'active',
  addEventListener: jest.fn((_event, listener) => {
    mockListeners.add(listener)
    return { remove: () => mockListeners.delete(listener) }
  }),
}
jest.mock('react', () => ({
  useEffect: (effect) => { mockEffect = effect },
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, mockSetState],
  useRef: (initial) => ({ current: initial }),
}))
jest.mock('react-native', () => ({ AppState: mockAppState }))
jest.mock('expo-location', () => ({ watchHeadingAsync: jest.fn() }))

const Location = require('expo-location')
const { useNow } = require('../useNow')
const { useTrueHeading } = require('../useTrueHeading')

// Drive real hook effects with a mocked React lifecycle and fake native sensors.
const changeState = (state) => {
  mockAppState.currentState = state
  for (const listener of mockListeners) listener(state)
}
const pendingWatch = () => {
  let resolve
  Location.watchHeadingAsync.mockReturnValueOnce(new Promise((done) => { resolve = done }))
  return resolve
}
const settle = async () => { await Promise.resolve(); await Promise.resolve() }

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-31T13:30:00Z'))
  jest.clearAllMocks()
  Location.watchHeadingAsync.mockReset()
  mockListeners.clear()
  mockAppState.currentState = 'active'
})
afterEach(() => jest.useRealTimers())

it('UI clocks stop in the background, catch up on resume and keep one timer', () => {
  useNow(1000)
  const cleanup = mockEffect()
  jest.advanceTimersByTime(2000)
  expect(mockSetState).toHaveBeenLastCalledWith(Date.now())
  expect(jest.getTimerCount()).toBe(1)
  changeState('background')
  const calls = mockSetState.mock.calls.length
  jest.advanceTimersByTime(60000)
  expect(mockSetState).toHaveBeenCalledTimes(calls)
  expect(jest.getTimerCount()).toBe(0)
  changeState('active')
  expect(mockSetState).toHaveBeenLastCalledWith(Date.now())
  changeState('active')
  expect(jest.getTimerCount()).toBe(1)
  cleanup()
  expect(jest.getTimerCount()).toBe(0)
  expect(mockListeners.size).toBe(0)
})

it('a background-mounted clock starts only after foregrounding', () => {
  mockAppState.currentState = 'background'
  useNow(10000)
  const cleanup = mockEffect()
  expect(jest.getTimerCount()).toBe(0)
  expect(mockSetState).not.toHaveBeenCalled()
  changeState('active')
  expect(jest.getTimerCount()).toBe(1)
  expect(mockSetState).toHaveBeenLastCalledWith(Date.now())
  cleanup()
})

it('a falsy interval starts no timer or AppState subscription', () => {
  useNow(null)
  expect(mockEffect()).toBeUndefined()
  expect(jest.getTimerCount()).toBe(0)
  expect(mockListeners.size).toBe(0)
})

it.each([false, true])('countdown stops on expiry (background=%s)', (background) => {
  useNow(1000, new Date(Date.now() + 2000).toISOString())
  const cleanup = mockEffect()
  if (background) changeState('background')
  jest.advanceTimersByTime(2000)
  if (background) changeState('active')
  expect(mockSetState).toHaveBeenLastCalledWith(Date.now())
  expect(jest.getTimerCount()).toBe(0)
  changeState('background')
  jest.advanceTimersByTime(60000)
  changeState('active')
  expect(mockSetState).toHaveBeenLastCalledWith(Date.now())
  expect(jest.getTimerCount()).toBe(0)
  cleanup()
})

it('rapid background/foreground transitions cannot start overlapping heading watches', async () => {
  const resolve = pendingWatch()
  const sub = { remove: jest.fn() }
  useTrueHeading(true)
  const cleanup = mockEffect()
  changeState('background')
  changeState('active')
  changeState('active')
  expect(Location.watchHeadingAsync).toHaveBeenCalledTimes(1)
  resolve(sub)
  await settle()
  expect(sub.remove).not.toHaveBeenCalled()
  cleanup()
  expect(sub.remove).toHaveBeenCalledTimes(1)
  expect(mockListeners.size).toBe(0)
})

it.each([false, true])('late heading subscription is removed (unmount=%s)', async (unmount) => {
  const resolve = pendingWatch()
  const sub = { remove: jest.fn() }
  useTrueHeading(true)
  const cleanup = mockEffect()
  if (unmount) cleanup(); else changeState('background')
  resolve(sub)
  await settle()
  expect(sub.remove).toHaveBeenCalledTimes(1)
  cleanup()
})

it('a stopped heading watch restarts once; throttling and inactive callbacks are safe', async () => {
  const first = { remove: jest.fn() }
  const second = { remove: jest.fn() }
  Location.watchHeadingAsync.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
  useTrueHeading(true, 66)
  const cleanup = mockEffect()
  await settle()
  const callback = Location.watchHeadingAsync.mock.calls[0][0]
  callback({ trueHeading: 90 })
  expect(mockSetState).toHaveBeenLastCalledWith({ trueHeading: 90 })
  callback({ trueHeading: 91 })
  expect(mockSetState).toHaveBeenLastCalledWith({ trueHeading: 90 })
  changeState('background')
  const calls = mockSetState.mock.calls.length
  jest.advanceTimersByTime(1000)
  callback({ trueHeading: 180 })
  expect(mockSetState).toHaveBeenCalledTimes(calls)
  expect(first.remove).toHaveBeenCalledTimes(1)
  changeState('active')
  changeState('active')
  await settle()
  expect(Location.watchHeadingAsync).toHaveBeenCalledTimes(2)
  Location.watchHeadingAsync.mock.calls[1][0]({ trueHeading: 180 })
  expect(mockSetState).toHaveBeenLastCalledWith({ trueHeading: 180 })
  cleanup()
  expect(second.remove).toHaveBeenCalledTimes(1)
})

it('a failed heading subscription recovers on the next foreground entry', async () => {
  const sub = { remove: jest.fn() }
  Location.watchHeadingAsync.mockRejectedValueOnce(new Error('sensor unavailable')).mockResolvedValueOnce(sub)
  useTrueHeading(true)
  const cleanup = mockEffect()
  await settle()
  expect(mockSetState).toHaveBeenLastCalledWith(null)
  changeState('background')
  changeState('active')
  await settle()
  expect(Location.watchHeadingAsync).toHaveBeenCalledTimes(2)
  cleanup()
  expect(sub.remove).toHaveBeenCalledTimes(1)
})
