import { useEffect, useRef, useState } from 'react'
import { View, Text } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { useFonts } from 'expo-font'
import * as Notifications from 'expo-notifications'
import { fontAssets } from './src/lib/fontAssets'
import { reconcileTracking } from './src/lib/locationTask'
import { COPY } from './src/lib/brand'
import { supabase } from './src/lib/supabase'
import { C, F } from './src/lib/theme'
import AuthScreen from './src/screens/AuthScreen'
import GamesScreen from './src/screens/GamesScreen'
import GameScreen from './src/screens/GameScreen'
import { PresentationRoot } from './src/ui/presentation'

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
  const [fontsLoaded, fontError] = useFonts(fontAssets)
  const [session, setSession] = useState(undefined)
  const [game, setGame] = useState(null)
  const previousUser = useRef(null)

  useEffect(() => {
    let alive = true
    let authChanged = false
    supabase.auth.getSession().then(({ data }) => {
      if (alive && !authChanged) setSession(data.session ?? null)
    }).catch(() => { if (alive && !authChanged) setSession(null) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      authChanged = true
      if (alive) setSession(s)
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    setGame(null)
    if (previousUser.current && previousUser.current !== session?.user.id) {
      Notifications.dismissAllNotificationsAsync().catch(() => {})
    }
    previousUser.current = session?.user.id
    reconcileTracking().catch(() => {})
  }, [session?.user.id])

  let body
  if ((!fontsLoaded && !fontError) || session === undefined) {
    body = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.ink }}>
        <Text style={{ color: C.cyan, fontFamily: F.mono, fontSize: 11, letterSpacing: 2 }}>{COPY.booting}</Text>
      </View>
    )
  } else if (!session) {
    body = <AuthScreen />
  } else if (!game || game.owner !== session.user.id) {
    body = <GamesScreen key={session.user.id} onOpen={(g) => setGame({ ...g, owner: session.user.id })} />
  } else {
    body = <GameScreen key={`${session.user.id}:${game.id}`} gameId={game.id} session={session} onBack={() => setGame(null)} />
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <PresentationRoot>{body}</PresentationRoot>
    </SafeAreaProvider>
  )
}
