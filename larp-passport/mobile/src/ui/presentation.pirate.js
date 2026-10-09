import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Animated, AppState, Easing, ScrollView, StyleSheet, TouchableOpacity as NativeTouchable, View } from 'react-native'
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg'
import { C } from '../lib/theme'
import { useReducedMotion } from '../lib/useReducedMotion'

// One motion preference for the presentation tree. Screens that open later
// inherit the resolved preference instead of querying it again on every tab.
const MotionPreference = createContext(true)
const Foreground = createContext(AppState.currentState === 'active')
const DecorationViewport = createContext(null)
const AnimatedTouchable = Animated.createAnimatedComponent(NativeTouchable)

export function PresentationRoot({ children }) {
  const reduced = useReducedMotion()
  const [foreground, setForeground] = useState(AppState.currentState === 'active')
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'))
    return () => subscription.remove()
  }, [])
  return <MotionPreference.Provider value={reduced}>
    <Foreground.Provider value={foreground}>{children}</Foreground.Provider>
  </MotionPreference.Provider>
}

// This wrapper stays mounted across tab changes. In particular, it does not
// key/recreate the Sites/Compass panel, so its answer and selection survive.
export function ScreenEntrance({ children, transitionKey = 'screen', style }) {
  const reduced = useContext(MotionPreference)
  const progress = useRef(new Animated.Value(1)).current
  const previous = useRef()
  useEffect(() => {
    progress.stopAnimation()
    const changed = previous.current !== transitionKey
    previous.current = transitionKey
    if (reduced || !changed) { progress.setValue(1); return undefined }
    progress.setValue(0)
    const animation = Animated.timing(progress, {
      toValue: 1, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [progress, reduced, transitionKey])
  return <Animated.View style={[style, {
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }),
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
  }]}>{children}</Animated.View>
}

// Visibility is measured only on layout/scroll, never on animation frames.
// The scroll view retains its children and forwards the existing callbacks.
export function MotionScrollView({ children, onScroll, onLayout, onContentSizeChange, ...props }) {
  const scroll = useRef(null)
  const listeners = useRef(new Set())
  const viewport = useRef({
    refresh() {
      scroll.current?.getNativeScrollRef()?.measureInWindow((_x, top, _width, height) => {
        listeners.current.forEach((listener) => listener({ top, bottom: top + height }))
      })
    },
    register(listener) {
      listeners.current.add(listener)
      viewport.refresh()
      return () => listeners.current.delete(listener)
    },
  }).current
  useEffect(() => () => listeners.current.clear(), [])
  return <DecorationViewport.Provider value={viewport}>
    <ScrollView {...props} ref={scroll} scrollEventThrottle={props.scrollEventThrottle ?? 100}
      onScroll={(event) => { viewport.refresh(); onScroll?.(event) }}
      onLayout={(event) => { viewport.refresh(); onLayout?.(event) }}
      onContentSizeChange={(width, height) => { viewport.refresh(); onContentSizeChange?.(width, height) }}>
      {children}
    </ScrollView>
  </DecorationViewport.Provider>
}

// Animate a static SVG layer with the native driver. It carries no status or
// reading data, cannot intercept touches, and never changes layout or inputs.
export function DecorativeLayer({ kind, enabled = true }) {
  const reduced = useContext(MotionPreference)
  const foreground = useContext(Foreground)
  const viewport = useContext(DecorationViewport)
  const surface = useRef(null)
  const progress = useRef(new Animated.Value(0)).current
  const [visible, setVisible] = useState(false)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    let mounted = true
    const unregister = viewport?.register((bounds) => {
      surface.current?.measureInWindow((_x, top, measuredWidth, height) => {
        if (mounted) setVisible(measuredWidth > 0 && height > 0 && top < bounds.bottom && top + height > bounds.top)
      })
    })
    return () => { mounted = false; unregister?.() }
  }, [viewport])
  const running = enabled && visible && width > 0 && foreground && !reduced
  useEffect(() => {
    progress.stopAnimation()
    progress.setValue(0)
    if (!running) return undefined
    const loop = Animated.loop(Animated.timing(progress, {
      toValue: 1, duration: kind === 'glow' ? 4000 : 6000,
      easing: Easing.linear, useNativeDriver: true, isInteraction: false,
    }))
    loop.start()
    return () => { loop.stop(); progress.stopAnimation(); progress.setValue(0) }
  }, [kind, progress, running])
  const shimmer = kind === 'shimmer'
  const opacity = !running ? 0 : progress.interpolate(shimmer
    ? { inputRange: [0, 0.65, 0.7, 0.95, 1], outputRange: [0, 0, 0.8, 0, 0] }
    : { inputRange: [0, 0.5, 1], outputRange: [0.02, 0.13, 0.02] })
  return <View ref={surface} collapsable={false} pointerEvents="none" accessible={false}
    importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}
    onLayout={(event) => { setWidth(event.nativeEvent.layout.width); viewport?.refresh() }}>
    <Animated.View style={[StyleSheet.absoluteFill, { opacity }, shimmer && {
      transform: [{ translateX: progress.interpolate({ inputRange: [0, 0.65, 0.95, 1], outputRange: [-width * 1.1, -width * 1.1, width * 1.1, width * 1.1] }) }],
    }]}>
      <Svg width="100%" height="100%">
        <Defs>{shimmer ? <LinearGradient id="motionBrass" x1="0" y1="0" x2="1" y2="0.25">
          <Stop offset="0.3" stopColor="#FFF4C1" stopOpacity="0" />
          <Stop offset="0.5" stopColor="#FFF4C1" stopOpacity="0.4" />
          <Stop offset="0.7" stopColor="#FFF4C1" stopOpacity="0" />
        </LinearGradient> : <RadialGradient id="motionLantern" cx="15%" cy="0%" rx="85%" ry="85%">
          <Stop offset="0" stopColor="#FFD779" />
          <Stop offset="0.7" stopColor="#FFD779" stopOpacity="0" />
        </RadialGradient>}</Defs>
        <Rect width="100%" height="100%" fill={`url(#${shimmer ? 'motionBrass' : 'motionLantern'})`} />
      </Svg>
    </Animated.View>
  </View>
}

// The same native touchable and callbacks, with a small, interruptible press
// displacement. Reduced motion keeps the usual opacity feedback only.
export function TouchableOpacity({ style, onPressIn, onPressOut, activeOpacity = 0.86, ...props }) {
  const reduced = useContext(MotionPreference)
  const depth = useRef(new Animated.Value(0)).current
  useEffect(() => {
    depth.stopAnimation()
    depth.setValue(0)
    return () => depth.stopAnimation()
  }, [depth, reduced])
  function press(value) {
    depth.stopAnimation()
    if (reduced) { depth.setValue(0); return }
    Animated.timing(depth, {
      toValue: value, duration: value ? 90 : 140, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start()
  }
  return <AnimatedTouchable {...props} activeOpacity={activeOpacity}
    onPressIn={(event) => { press(1); onPressIn?.(event) }}
    onPressOut={(event) => { press(0); onPressOut?.(event) }}
    style={[style, { transform: [{ translateY: depth.interpolate({ inputRange: [0, 1], outputRange: [0, 1.5] }) }] }]} />
}

const shadow = { shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3 }
const card = { ...shadow, borderRadius: 12, borderColor: C.brassDeep, borderTopColor: C.wood600 }
const input = { borderRadius: 10, minHeight: 48, paddingVertical: 12 }
const button = { borderRadius: 10, ...shadow, shadowOpacity: 0.12, elevation: 2 }

// Only style overrides live here; source screens still own all their data,
// actions, validation, wording and visibility conditions.
const overrides = {
  common: {
    scrollContent: { padding: 16, paddingBottom: 40 },
    neutralCard: { ...card, padding: 20 },
    input,
    inputLabel: { marginBottom: 8 },
    field: { marginBottom: 16 },
  },
  auth: {
    keyboard: { paddingHorizontal: 24, paddingVertical: 32 },
    scanLineOne: { opacity: 0.4 }, scanLineTwo: { opacity: 0.4 },
    identityBlock: { marginBottom: 32 },
    markOuter: { width: 56, height: 56, borderRadius: 28, borderColor: C.brass, backgroundColor: C.wood900, ...shadow },
    markInner: { borderColor: C.brassLight },
    tagline: { fontFamily: 'AlegreyaSans_400Regular', fontSize: 16, lineHeight: 23, letterSpacing: 0 },
    card: { ...card, padding: 20 },
    cardHeader: { paddingBottom: 16, marginBottom: 20 },
    field: { marginBottom: 16 }, label: { marginBottom: 8 }, input,
    primaryButton: { ...button, marginTop: 8 }, modeButton: { paddingTop: 16 },
  },
  games: {
    safe: { paddingHorizontal: 16 },
    header: { paddingTop: 24, paddingBottom: 24 },
    title: { fontSize: 28, letterSpacing: 0.6 },
    joinCard: { ...card, borderColor: C.brassDeep, padding: 20 },
    joinRow: { gap: 8 }, codeInput: { ...input, minWidth: 0 },
    joinButton: { ...button, minWidth: 72, paddingHorizontal: 16 },
    gameCard: { ...card, padding: 16, marginBottom: 12 },
    gameName: { fontSize: 20, letterSpacing: 0 },
    gameStatus: { letterSpacing: 0.4, lineHeight: 20, marginTop: 4 },
    arrow: { color: C.brassLight, fontSize: 24, paddingLeft: 12 },
    listGap: { marginTop: 24 }, signout: { paddingVertical: 16 },
  },
  character: {
    cyanButton: button, avatar: { ...card, width: 48, height: 48 },
    characterName: { flexShrink: 1, lineHeight: 28 },
    statCard: { ...card, minWidth: 88, paddingVertical: 16 },
    editSection: { marginTop: 24 },
  },
  events: {
    messageCard: { ...card, padding: 20, marginBottom: 16 },
    messageInput: { marginTop: 12 }, messageFooter: { marginTop: 12, gap: 8, flexWrap: 'wrap' },
    smallCyanButton: { ...button, paddingHorizontal: 16 },
    eventCard: { ...card, paddingHorizontal: 16, paddingVertical: 16, marginBottom: 12 },
    eventTopRow: { gap: 8, flexWrap: 'wrap' }, eventTag: { flexShrink: 1 },
    eventTitle: { lineHeight: 24, marginTop: 8 },
  },
  sharing: {
    sharingTitle: { fontSize: 18, lineHeight: 24 }, sharingHeader: { gap: 12, marginBottom: 8 },
    telemetryCard: { ...card, padding: 20, marginTop: 16 },
    telemetryRow: { gap: 8, marginTop: 16 }, telemetryCell: { borderRadius: 10, paddingVertical: 12 },
    detailsToggle: { marginTop: 16 },
  },
  primitives: {
    outcomeNote: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
    outcomeDismiss: { paddingHorizontal: 8 }, ghostButton: { borderRadius: 10, marginTop: 16 },
  },
}

export function screenStyles(screen, base) {
  const extra = overrides[screen] ?? {}
  return StyleSheet.create(Object.fromEntries(Object.entries(base).map(([key, value]) => [key, { ...value, ...extra[key] }])))
}
