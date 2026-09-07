// Keep the server's consent result and the device's actual tracking state
// distinct: a stopped GPS service does not prove server revocation succeeded.
export async function updateLocationConsent({ gameId, enabled, rpc, start, stop, onStopped }) {
  async function consent(grant) {
    const { error } = await rpc('set_location_consent', { g: gameId, grant_consent: grant })
    if (error) throw new Error(error.message)
  }

  if (!enabled) {
    await stop()
    onStopped()
    try {
      await consent(false)
    } catch (error) {
      throw new Error(`Tracking stopped on this phone, but server consent could not be revoked. Retry when connected. ${error.message}`)
    }
    return
  }

  await consent(true)
  try {
    await start(gameId)
  } catch (error) {
    try {
      await consent(false)
    } catch (revokeError) {
      throw new Error(`${error.message} Server consent could not be revoked: ${revokeError.message}`)
    }
    throw error
  }
}
