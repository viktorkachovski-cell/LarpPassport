import { updateLocationConsent } from '../locationConsent'

function setup(enabled) {
  return {
    gameId: 'game-a', enabled,
    rpc: jest.fn().mockResolvedValue({ error: null }),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    onStopped: jest.fn(),
  }
}

test('does not start GPS when the consent RPC returns an error', async () => {
  const options = setup(true)
  options.rpc.mockResolvedValue({ error: { message: 'not a member' } })
  await expect(updateLocationConsent(options)).rejects.toThrow('not a member')
  expect(options.start).not.toHaveBeenCalled()
})

test('enables GPS only after server consent succeeds', async () => {
  const options = setup(true)
  await updateLocationConsent(options)
  expect(options.rpc).toHaveBeenCalledWith('set_location_consent', { g: 'game-a', grant_consent: true })
  expect(options.start).toHaveBeenCalledWith('game-a')
  expect(options.rpc.mock.invocationCallOrder[0]).toBeLessThan(options.start.mock.invocationCallOrder[0])
})

test('revokes consent if native permissions or startup fail', async () => {
  const options = setup(true)
  options.start.mockRejectedValue(new Error('Background permission denied'))
  await expect(updateLocationConsent(options)).rejects.toThrow('Background permission denied')
  expect(options.rpc).toHaveBeenLastCalledWith('set_location_consent', { g: 'game-a', grant_consent: false })
})

test('reports a failed rollback instead of claiming consent is off', async () => {
  const options = setup(true)
  options.start.mockRejectedValue(new Error('Permission denied'))
  options.rpc.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'offline' } })
  await expect(updateLocationConsent(options)).rejects.toThrow('Server consent could not be revoked: offline')
})

test('stops GPS and updates its UI even if the server cannot revoke consent', async () => {
  const options = setup(false)
  options.rpc.mockResolvedValue({ error: { message: 'offline' } })
  await expect(updateLocationConsent(options)).rejects.toThrow('Tracking stopped on this phone')
  expect(options.onStopped).toHaveBeenCalledTimes(1)
  expect(options.stop.mock.invocationCallOrder[0]).toBeLessThan(options.rpc.mock.invocationCallOrder[0])
})

test('does not display tracking as stopped when the native stop fails', async () => {
  const options = setup(false)
  options.stop.mockRejectedValue(new Error('native error'))
  await expect(updateLocationConsent(options)).rejects.toThrow('native error')
  expect(options.onStopped).not.toHaveBeenCalled()
})
