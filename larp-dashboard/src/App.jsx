import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import AuthScreen from './components/AuthScreen'
import GamesList from './components/GamesList'
import GameView from './components/GameView'

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [gameId, setGameId] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div className="center-screen"><p className="hint">Loading…</p></div>
  if (!session) return <AuthScreen />
  if (!gameId) return <GamesList session={session} onOpen={setGameId} />
  return <GameView key={gameId} gameId={gameId} session={session} onBack={() => setGameId(null)} />
}
