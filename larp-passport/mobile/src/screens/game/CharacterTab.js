import { memo, useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'
import { COPY } from '../../lib/brand'
import { supabase } from '../../lib/supabase'
import { C, F, S, T } from '../../lib/theme'
import { common } from '../../ui/common'
import { screenStyles, TouchableOpacity } from '../../ui/presentation'
import { Field, OutcomeNote } from '../../ui/primitives'

const copy = COPY.character

// Scrolls on its own as a tab; `embedded` drops the ScrollView so another
// panel (the pirate Hold) can place it inside its own scroll.
function Scroll({ embedded, children }) {
  if (embedded) return <View>{children}</View>
  return <ScrollView style={common.flex} contentContainerStyle={common.scrollContent} keyboardShouldPersistTaps="handled">{children}</ScrollView>
}

export const CharacterSheet = memo(function CharacterSheet({ character, stats, embedded = false }) {
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const fields = character.fields ?? {}
  const editable = stats.filter((stat) => stat.player_editable)
  const locked = stats.filter((stat) => !stat.player_editable)
  const values = draft ?? {}
  const valueOf = (key) => key in values ? values[key] : fields[key]
  const dirty = draft && Object.keys(draft).some((key) => String(draft[key]) !== String(fields[key] ?? ''))

  async function save() {
    if (busy) return
    setBusy(true); setError(''); setSaved(false)
    try {
    const next = { ...fields }
    for (const stat of editable) {
      if (!(stat.key in values)) continue
      next[stat.key] = stat.type === 'number' ? Number(values[stat.key]) : String(values[stat.key] ?? '')
      if (stat.type === 'number' && !Number.isFinite(next[stat.key])) next[stat.key] = stat.default ?? 0
    }
    const { error: saveError } = await supabase.from('characters').update({ fields: next }).eq('id', character.id)
    if (saveError) { setError(saveError.message); return }
    setDraft(null)
    setSaved(true)
    } catch (error) { setError(error.message) } finally { setBusy(false) }
  }

  return (
    <Scroll embedded={embedded}>
      <View style={styles.identityRow}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(character.name)}</Text></View>
        <View style={common.flex}>
          <Text style={styles.characterName}>{character.name}</Text>
          {!!character.bio && <Text style={styles.characterBio}>{character.bio}</Text>}
        </View>
      </View>

      {locked.length > 0 && (
        <>
          <Text style={styles.sheetLabel}>{copy.lockedLabel}</Text>
          <View style={styles.statGrid}>
            {locked.map((stat) => (
              <View key={stat.key} style={styles.statCard}>
                <Text style={[styles.statValue, { color: statColor(stat, fields[stat.key]) }]}>{String(fields[stat.key] ?? '--')}</Text>
                <Text style={styles.statLabel}>{String(stat.label || stat.key).toUpperCase()}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {editable.length > 0 && (
        <View style={styles.editSection}>
          <Text style={styles.sheetLabel}>{copy.editLabel}</Text>
          {editable.map((stat) => (
            <View key={stat.key} style={common.field}>
              <Text style={common.inputLabel}>{String(stat.label || stat.key).toUpperCase()}{stat.type === 'number' && stat.min !== undefined && stat.max !== undefined ? ` // ${stat.min}-${stat.max}` : ''}</Text>
              <TextInput
                style={common.input}
                accessibilityLabel={String(stat.label || stat.key)}
                keyboardType={stat.type === 'number' ? 'numeric' : 'default'}
                value={String(valueOf(stat.key) ?? '')}
                onChangeText={(value) => setDraft({ ...(draft ?? {}), [stat.key]: value })}
              />
            </View>
          ))}
          <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: !dirty || busy }} disabled={!dirty || busy} onPress={save} style={[styles.cyanButton, (!dirty || busy) && common.disabled]}>
            <Text style={common.filledButtonText}>{busy ? 'SAVING...' : 'SAVE CHANGES'}</Text>
          </TouchableOpacity>
          {!!error && <Text style={common.errorText} accessibilityLiveRegion="polite">{error}</Text>}
          {saved && <OutcomeNote text="Changes saved." onDismiss={() => setSaved(false)} />}
        </View>
      )}
    </Scroll>
  )
})

export function CreateCharacter({ game, uid, onCreated, embedded = false }) {
  const stats = game.template?.stats ?? []
  const editable = stats.filter((stat) => stat.player_editable)
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [values, setValues] = useState(() => Object.fromEntries(editable.map((stat) => [stat.key, stat.default ?? (stat.type === 'number' ? 0 : '')])))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function create() {
    if (!name.trim()) { setError('Your character needs a name.'); return }
    setBusy(true); setError('')
    try {
    const fields = {}
    for (const stat of editable) fields[stat.key] = stat.type === 'number' ? Number(values[stat.key]) || 0 : String(values[stat.key] ?? '')
    const { data, error: createError } = await supabase.from('characters')
      .insert({ game_id: game.id, user_id: uid, name: name.trim(), bio: bio.trim(), fields })
      .select().single()
    setBusy(false)
    if (createError) { setError(createError.message); return }
    onCreated(data)
    } catch (error) { setError(error.message) } finally { setBusy(false) }
  }

  return (
    <Scroll embedded={embedded}>
      <View style={common.neutralCard}>
        <Text style={common.cyanKicker}>{copy.createKicker}</Text>
        <Text style={common.sectionTitle}>{copy.createTitle}</Text>
        <Text style={common.bodyCopy}>This is who you will be in {game.name}.</Text>
        <View style={styles.editSection}>
          <Field label="NAME" value={name} onChangeText={setName} placeholder={copy.namePlaceholder} />
          <Field label="BIO" value={bio} onChangeText={setBio} multiline placeholder={copy.bioPlaceholder} style={styles.bioInput} />
          {editable.map((stat) => (
            <Field
              key={stat.key}
              label={String(stat.label || stat.key).toUpperCase()}
              keyboardType={stat.type === 'number' ? 'numeric' : 'default'}
              value={String(values[stat.key] ?? '')}
              onChangeText={(value) => setValues({ ...values, [stat.key]: value })}
            />
          ))}
          <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={create} style={[styles.cyanButton, busy && common.disabled]}>
            <Text style={common.filledButtonText}>{busy ? copy.creatingButton : copy.createButton}</Text>
          </TouchableOpacity>
          {!!error && <Text style={common.errorText}>{error}</Text>}
          {!!copy.gmStatsCaption && <Text style={common.privateCaption}>{copy.gmStatsCaption}</Text>}
        </View>
      </View>
    </Scroll>
  )
}

function initials(name) {
  return String(name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function statColor(stat, value) {
  const identity = `${stat.key} ${stat.label ?? ''}`.toLowerCase()
  if (identity.includes('paradox')) return C.amber
  if ((identity.includes('life') || identity.includes('health')) && Number(value) <= 1) return C.red
  return C.cyan
}

const styles = screenStyles('character', {
  cyanButton: { minHeight: S.touch, backgroundColor: C.cyan, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, paddingHorizontal: 12 },
  identityRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  avatar: { width: 46, height: 46, borderRadius: 6, backgroundColor: C.panel, borderColor: C.cyanBorder, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { color: C.cyan, fontFamily: F.displayBold, fontSize: 17 },
  characterName: { color: C.text, fontFamily: F.displayBold, fontSize: 22 },
  characterBio: { color: C.muted, fontFamily: F.body, fontSize: T.body, lineHeight: T.lineBody, marginTop: 2 },
  sheetLabel: { color: C.muted, fontFamily: F.monoSemiBold, fontSize: T.label, letterSpacing: 1.1, marginBottom: 9 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard: { minWidth: 94, flexGrow: 1, backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 8, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 13 },
  statValue: { fontFamily: F.displayBold, fontSize: 23 },
  statLabel: { color: C.muted, fontFamily: F.monoSemiBold, fontSize: T.micro, letterSpacing: 0.7, marginTop: 3, textAlign: 'center' },
  editSection: { marginTop: 22 },
  bioInput: { minHeight: 76, textAlignVertical: 'top' },
})
