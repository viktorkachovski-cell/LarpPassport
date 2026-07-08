import { useEffect, useState } from 'react'
import { View, Text } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import * as Notifications from 'expo-notifications'
import { supabase } from './src/lib/supabase'
import { C } from './src/lib/theme'
import AuthScreen from './src/screens/AuthScreen'
import GamesScreen from './src/screens/GamesScreen'
import GameScreen from './src/screens/GameScreen'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

export default function App() {
  const [session, setSession] = useState(undefined)
  const [game, setGame] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  let body
  if (session === undefined) {
    body = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.ink }}>
        <Text style={{ color: C.muted }}>Loading…</Text>
      </View>
    )
  } else if (!session) {
    body = <AuthScreen />
  } else if (!game) {
    body = <GamesScreen session={session} onOpen={setGame} />
  } else {
    body = <GameScreen key={game.id} gameId={game.id} session={session} onBack={() => setGame(null)} />
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {body}
    </SafeAreaProvider>
  )
}
