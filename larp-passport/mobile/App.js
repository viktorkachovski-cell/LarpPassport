import { useEffect, useState } from 'react'
import { View, Text } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { useFonts } from 'expo-font'
import * as Notifications from 'expo-notifications'
import { ChakraPetch_500Medium } from '@expo-google-fonts/chakra-petch/500Medium'
import { ChakraPetch_600SemiBold } from '@expo-google-fonts/chakra-petch/600SemiBold'
import { ChakraPetch_700Bold } from '@expo-google-fonts/chakra-petch/700Bold'
import { IBMPlexSans_400Regular } from '@expo-google-fonts/ibm-plex-sans/400Regular'
import { IBMPlexSans_500Medium } from '@expo-google-fonts/ibm-plex-sans/500Medium'
import { IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans/600SemiBold'
import { IBMPlexSans_700Bold } from '@expo-google-fonts/ibm-plex-sans/700Bold'
import { IBMPlexMono_400Regular } from '@expo-google-fonts/ibm-plex-mono/400Regular'
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono/500Medium'
import { IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono/600SemiBold'
import { supabase } from './src/lib/supabase'
import { C, F } from './src/lib/theme'
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
  const [fontsLoaded] = useFonts({
    ChakraPetch_500Medium,
    ChakraPetch_600SemiBold,
    ChakraPetch_700Bold,
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexSans_700Bold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  })
  const [session, setSession] = useState(undefined)
  const [game, setGame] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  let body
  if (!fontsLoaded || session === undefined) {
    body = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.ink }}>
        <Text style={{ color: C.cyan, fontFamily: F.mono, fontSize: 11, letterSpacing: 2 }}>INITIALIZING...</Text>
      </View>
    )
  } else if (!session) {
    body = <AuthScreen />
  } else if (!game) {
    body = <GamesScreen onOpen={setGame} />
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
