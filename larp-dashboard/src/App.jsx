import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import AuthScreen from './components/AuthScreen'
import GamesList from './components/GamesList'
import GameView from './components/GameView'

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [selection, setSelection] = useState(null)
  const gameId = selection?.owner === session?.user.id ? selection?.id : null

  useEffect(() => {
    let alive = true
    let authChanged = false
    supabase.auth.getSession().then(({ data }) => {
      if (alive && !authChanged) setSession(data.session ?? null)
    }).catch(() => { if (alive && !authChanged) setSession(null) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      authChanged = true
      if (alive) setSession(session)
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])

  useEffect(() => { setSelection(null) }, [session?.user.id])

  if (session === undefined) return <div className="center-screen"><p className="hint">Loading…</p></div>
  if (!session) return <AuthScreen />
  if (!gameId) return <GamesList key={session.user.id} session={session} onOpen={(id) => setSelection({ id, owner: session.user.id })} />
  return <GameView key={`${session.user.id}:${gameId}`} gameId={gameId} session={session} onBack={() => setSelection(null)} />
}
