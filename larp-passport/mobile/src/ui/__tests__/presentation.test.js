const fs = require('fs')
const path = require('path')
const vm = require('vm')
const babel = require('@babel/core')

// Exercise the real presentation component effects without a native device.
// This uses the Babel tooling already bundled with Expo, not another renderer.
function runtime(pirate = true) {
  let reduced = false
  let foreground = true
  let viewport = null
  let refCursor = 0
  let effectCursor = 0
  let stateCursor = 0
  const refs = []
  const effects = []
  const states = []
  const contexts = []
  const animations = []
  const loops = []
  const subscriptions = []
  class Value {
    constructor(value) { this.value = value }
    setValue(value) { this.value = value }
    stopAnimation() {}
    interpolate(options) { return options }
  }
  const NativeTouchable = 'NativeTouchable'
  const React = {
    createContext: (value) => { const context = { Provider: 'Provider', value }; contexts.push(context); return context },
    createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children } }),
    useContext: (context) => context === contexts[0] ? reduced : context === contexts[1] ? foreground : viewport,
    useRef: (initial) => { const index = refCursor++; return refs[index] ?? (refs[index] = { current: initial }) },
    useState: (initial) => {
      const index = stateCursor++
      if (!(index in states)) states[index] = initial
      return [states[index], (value) => { states[index] = value }]
    },
    useEffect: (effect, deps) => {
      const index = effectCursor++
      const previous = effects[index]
      if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) {
        previous?.cleanup?.()
        effects[index] = { deps, cleanup: effect() }
      }
    },
  }
  const native = {
    TouchableOpacity: NativeTouchable,
    ScrollView: 'NativeScrollView', View: 'View',
    AppState: { currentState: 'active', addEventListener: (_event, listener) => {
      const subscription = { listener, remove: jest.fn() }
      subscriptions.push(subscription)
      return subscription
    } },
    StyleSheet: { create: (styles) => styles },
    Easing: { cubic: 'cubic', linear: 'linear', out: (value) => value },
    Animated: {
      Value, View: 'AnimatedView', createAnimatedComponent: () => 'AnimatedTouchable',
      timing: (value, options) => {
        const animation = { options, start: jest.fn(() => { value.value = options.toValue }), stop: jest.fn() }
        animations.push(animation)
        return animation
      },
      loop: (animation) => {
        const loop = { animation, start: jest.fn(), stop: jest.fn() }
        loops.push(loop)
        return loop
      },
    },
  }
  const filename = path.join(__dirname, '..', pirate ? 'presentation.pirate.js' : 'presentation.js')
  const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
    configFile: false, babelrc: false,
    presets: [[require.resolve('@babel/preset-env'), { targets: { node: 'current' } }]],
    plugins: [require.resolve('@babel/plugin-transform-react-jsx')],
  }).code
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, React, require: (name) => {
    if (name === 'react') return React
    if (name === 'react-native') return native
    if (name === 'react-native-svg') return { default: 'Svg', Defs: 'Defs', LinearGradient: 'LinearGradient', RadialGradient: 'RadialGradient', Rect: 'Rect', Stop: 'Stop' }
    if (name === '../lib/theme') return { C: {} }
    if (name === '../lib/useReducedMotion') return { useReducedMotion: () => reduced }
    throw new Error(`Unexpected import ${name}`)
  } }, { filename })
  return {
    ...module.exports, animations, loops, subscriptions, NativeTouchable,
    reduce: (value) => { reduced = value },
    foreground: (value) => { foreground = value },
    viewport: (value) => { viewport = value },
    render: (component, props) => { refCursor = 0; effectCursor = 0; stateCursor = 0; return component(props) },
    unmount: () => effects.forEach((effect) => effect?.cleanup?.()),
  }
}

test('tab entrances retain their children and do not replay on data refresh', () => {
  const ui = runtime()
  const panel = { typedAnswer: 'anchor' }
  const first = ui.render(ui.ScreenEntrance, { children: panel, transitionKey: 'sites' })
  expect(first.props.children).toBe(panel)
  expect(ui.animations).toHaveLength(1)
  ui.render(ui.ScreenEntrance, { children: panel, transitionKey: 'sites' })
  expect(ui.animations).toHaveLength(1)
  const compass = ui.render(ui.ScreenEntrance, { children: panel, transitionKey: 'compass' })
  expect(compass.props.children).toBe(panel)
  expect(compass.props.key).toBeUndefined()
  expect(ui.animations[0].stop).toHaveBeenCalledTimes(1)
  expect(ui.animations[1].options).toMatchObject({ duration: 350, useNativeDriver: true })
  ui.render(ui.ScreenEntrance, { children: panel, transitionKey: 'sites' })
  expect(ui.animations[1].stop).toHaveBeenCalledTimes(1)
  ui.unmount()
  expect(ui.animations[2].stop).toHaveBeenCalledTimes(1)
})

test('reduced motion snaps and changing the preference does not replay a tab', () => {
  const ui = runtime()
  ui.reduce(true)
  ui.render(ui.ScreenEntrance, { children: 'panel', transitionKey: 'sites' })
  ui.reduce(false)
  ui.render(ui.ScreenEntrance, { children: 'panel', transitionKey: 'sites' })
  expect(ui.animations).toHaveLength(0)
  ui.render(ui.ScreenEntrance, { children: 'panel', transitionKey: 'compass' })
  expect(ui.animations).toHaveLength(1)
  ui.reduce(true)
  ui.render(ui.ScreenEntrance, { children: 'panel', transitionKey: 'compass' })
  expect(ui.animations[0].stop).toHaveBeenCalledTimes(1)
})

test('press feedback preserves action callbacks and stops moving with reduced motion', () => {
  const ui = runtime()
  const onPress = jest.fn(), onPressIn = jest.fn(), onPressOut = jest.fn()
  let button = ui.render(ui.TouchableOpacity, { onPress, onPressIn, onPressOut, disabled: true, children: 'Submit answer' })
  expect(button.props.onPress).toBe(onPress)
  expect(button.props.disabled).toBe(true)
  button.props.onPressIn('in')
  button.props.onPressOut('out')
  expect(onPressIn).toHaveBeenCalledWith('in')
  expect(onPressOut).toHaveBeenCalledWith('out')
  expect(ui.animations.map((animation) => animation.options.duration)).toEqual([90, 140])
  ui.reduce(true)
  button = ui.render(ui.TouchableOpacity, { onPress, children: 'Submit answer' })
  button.props.onPressIn()
  button.props.onPressOut()
  expect(ui.animations).toHaveLength(2)
})

test('Time Hunt keeps native controls, original styles and the child view tree', () => {
  const ui = runtime(false)
  const styles = { card: { borderRadius: 6 }, button: { minHeight: 48 } }
  const children = { screen: 'hunt' }
  expect(ui.screenStyles('auth', styles)).toBe(styles)
  expect(ui.TouchableOpacity).toBe(ui.NativeTouchable)
  expect(ui.ScreenEntrance({ children })).toBe(children)
  expect(ui.PresentationRoot({ children })).toBe(children)
  expect(ui.MotionScrollView).toBe('NativeScrollView')
})

// Native measurements are callbacks. Move the measured surface relative to
// the viewport to exercise visibility without React updates on each frame.
function visibleLayer(ui, kind, enabled = true) {
  let listener
  let top = 50
  const bounds = { top: 0, bottom: 500 }
  const unregister = jest.fn()
  const viewport = { register: (next) => { listener = next; return unregister }, refresh: () => listener(bounds) }
  ui.viewport(viewport)
  const props = { kind, enabled }
  const layer = ui.render(ui.DecorativeLayer, props)
  layer.props.ref.current = { measureInWindow: (callback) => callback(0, top, 240, 80) }
  layer.props.onLayout({ nativeEvent: { layout: { width: 240 } } })
  ui.render(ui.DecorativeLayer, props)
  return { props, unregister, move: (next) => { top = next; viewport.refresh(); ui.render(ui.DecorativeLayer, props) } }
}

test('decorative loops stop offscreen, in the background, with reduced motion and on unmount', () => {
  const ui = runtime()
  const layer = visibleLayer(ui, 'glow')
  expect(ui.loops).toHaveLength(1)
  expect(ui.loops[0].animation.options).toMatchObject({ duration: 4000, useNativeDriver: true, isInteraction: false })
  layer.move(600)
  expect(ui.loops[0].stop).toHaveBeenCalledTimes(1)
  layer.move(50)
  expect(ui.loops).toHaveLength(2)
  ui.foreground(false)
  ui.render(ui.DecorativeLayer, layer.props)
  expect(ui.loops[1].stop).toHaveBeenCalledTimes(1)
  ui.foreground(true)
  ui.render(ui.DecorativeLayer, layer.props)
  ui.reduce(true)
  const reduced = ui.render(ui.DecorativeLayer, layer.props)
  expect(ui.loops[2].stop).toHaveBeenCalledTimes(1)
  expect(reduced.props.children.props.style[1].opacity).toBe(0)
  ui.reduce(false)
  ui.render(ui.DecorativeLayer, layer.props)
  ui.unmount()
  expect(ui.loops[3].stop).toHaveBeenCalledTimes(1)
  expect(layer.unregister).toHaveBeenCalledTimes(1)
})

test('disabled brass controls do not shimmer and becoming busy stops the loop', () => {
  const ui = runtime()
  const layer = visibleLayer(ui, 'shimmer', false)
  expect(ui.loops).toHaveLength(0)
  ui.render(ui.DecorativeLayer, { ...layer.props, enabled: true })
  expect(ui.loops[0].animation.options).toMatchObject({ duration: 6000, useNativeDriver: true, isInteraction: false })
  ui.render(ui.DecorativeLayer, layer.props)
  expect(ui.loops[0].stop).toHaveBeenCalledTimes(1)
})

test('scroll visibility tracking retains children, callbacks and keyboard behavior', () => {
  const ui = runtime()
  const children = { answer: 'anchor' }
  const onScroll = jest.fn(), onLayout = jest.fn(), onContentSizeChange = jest.fn()
  const tree = ui.render(ui.MotionScrollView, { children, keyboardShouldPersistTaps: 'handled', onScroll, onLayout, onContentSizeChange })
  const scroll = tree.props.children
  scroll.props.ref.current = { getNativeScrollRef: () => ({ measureInWindow: (callback) => callback(0, 140, 320, 500) }) }
  const observer = jest.fn()
  const unregister = tree.props.value.register(observer)
  expect(observer).toHaveBeenCalledWith({ top: 140, bottom: 640 })
  const event = { nativeEvent: { contentOffset: { y: 120 } } }
  scroll.props.onScroll(event)
  scroll.props.onLayout(event)
  scroll.props.onContentSizeChange(320, 800)
  expect(onScroll).toHaveBeenCalledWith(event)
  expect(onLayout).toHaveBeenCalledWith(event)
  expect(onContentSizeChange).toHaveBeenCalledWith(320, 800)
  expect(scroll.props.children).toBe(children)
  expect(scroll.props.keyboardShouldPersistTaps).toBe('handled')
  unregister()
  const calls = observer.mock.calls.length
  scroll.props.onScroll(event)
  expect(observer).toHaveBeenCalledTimes(calls)
  ui.unmount()
})

test('app lifecycle updates the foreground preference and releases its subscription', () => {
  const ui = runtime()
  const render = () => ui.render(ui.PresentationRoot, { children: 'screen' })
  expect(render().props.children.props.value).toBe(true)
  ui.subscriptions[0].listener('background')
  expect(render().props.children.props.value).toBe(false)
  ui.subscriptions[0].listener('active')
  expect(render().props.children.props.value).toBe(true)
  ui.unmount()
  expect(ui.subscriptions[0].remove).toHaveBeenCalledTimes(1)
})
