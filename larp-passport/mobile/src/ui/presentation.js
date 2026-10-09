import { ScrollView, StyleSheet, TouchableOpacity } from 'react-native'

// Time Hunt keeps the native controls, original styles and original view tree.
// Metro substitutes presentation.pirate.js only in The Black Tide build.
export { ScrollView as MotionScrollView, TouchableOpacity }
export const screenStyles = (_screen, base) => StyleSheet.create(base)
export function PresentationRoot({ children }) { return children }
export function ScreenEntrance({ children }) { return children }
