import { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

export const colors = {
  canvas: '#F5F3EC', paper: '#FFFDF8', ink: '#202D26', muted: '#59685E',
  forest: '#183C32', forestDark: '#122F28', sage: '#E5ECE2', lime: '#DDEB9D',
  copper: '#9A482E', line: '#DFE0D4', error: '#A23026',
};

const serif = Platform.select({ web: 'Georgia, serif', ios: 'Georgia', default: 'serif' });
export const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  body: { flex: 1, minWidth: 0 },
  frame: { flex: 1 },
  desktop: { flexDirection: 'row' },
  content: { padding: 20, paddingBottom: 40, gap: 19, maxWidth: 1280, width: '100%', alignSelf: 'center' },
  contentWide: { padding: 36, paddingBottom: 48 },
  auth: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 18 },
  authShell: { width: '100%', maxWidth: 1030, flexDirection: 'column', backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', borderRadius: 26 },
  authWide: { flexDirection: 'row', minHeight: 620 },
  authForm: { flex: 1, gap: 14, padding: 22, justifyContent: 'center' },
  authFormWide: { padding: 38 },
  title: { fontFamily: serif, fontWeight: '400', fontSize: 38, letterSpacing: -1.6, color: colors.ink },
  hero: { backgroundColor: colors.forest, borderRadius: 22, padding: 23, overflow: 'hidden', minHeight: 132, justifyContent: 'center' },
  heroWide: { minHeight: 171, padding: 30 },
  heroTitle: { color: colors.paper, fontFamily: serif, fontSize: 33, letterSpacing: -1, fontWeight: '400' },
  heroMeta: { color: '#CBDED0', fontSize: 13, lineHeight: 20 },
  heading: { fontSize: 21, color: colors.ink, letterSpacing: -0.45, fontWeight: '700' },
  subtitle: { fontSize: 14, color: colors.muted, lineHeight: 22 },
  small: { fontSize: 12, color: colors.muted, lineHeight: 19 },
  label: { fontSize: 13, color: colors.ink, fontWeight: '600' },
  card: { padding: 20, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 18, gap: 17 },
  cardHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  nestedCard: { padding: 17, backgroundColor: '#F8F7F0', borderWidth: 1, borderColor: colors.line, borderRadius: 14, gap: 12 },
  form: { backgroundColor: '#F1F2E9', padding: 17, borderRadius: 13, gap: 14 },
  input: { borderWidth: 1, borderColor: '#C9D0C3', backgroundColor: '#FFFDF8', paddingHorizontal: 13, paddingVertical: 11, borderRadius: 9, minHeight: 46, color: colors.ink, fontSize: 14 },
  inputFocused: { borderColor: colors.forest, backgroundColor: '#FFFFFF' },
  button: { minHeight: 44, paddingHorizontal: 15, paddingVertical: 10, backgroundColor: colors.forest, borderWidth: 1, borderColor: colors.forest, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontWeight: '700', color: colors.paper, fontSize: 13, textAlign: 'center' },
  secondary: { backgroundColor: colors.paper, borderColor: '#C9D0C3' },
  secondaryText: { color: colors.forest },
  filterSelected: { backgroundColor: colors.sage, borderColor: colors.forest },
  filterText: { color: colors.forest },
  pressed: { opacity: 0.76 },
  disabled: { opacity: 0.46 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 9 },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 15, borderBottomWidth: 1, borderColor: colors.line },
  avatar: { width: 39, height: 39, borderRadius: 12, backgroundColor: colors.sage, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.forest, fontWeight: '700', fontSize: 13 },
  identity: { flex: 1, minWidth: 150, gap: 2 },
  error: { color: colors.error, lineHeight: 20 },
  message: { backgroundColor: colors.sage, padding: 13, borderRadius: 10, color: colors.forest, lineHeight: 21 },
  loading: { padding: 30, color: colors.ink },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metric: { flexGrow: 1, flexBasis: 190, minWidth: 0, gap: 5, backgroundColor: colors.sage, borderRadius: 13, padding: 15 },
  metricValue: { color: colors.forest, fontFamily: serif, fontSize: 31, fontVariant: ['tabular-nums'] },
  badge: { alignSelf: 'flex-start', borderRadius: 20, paddingVertical: 5, paddingHorizontal: 9, backgroundColor: colors.sage },
  badgeText: { color: colors.forest, fontSize: 12, fontWeight: '700' },
  badgePending: { backgroundColor: '#F0E4D4' },
  badgePendingText: { color: '#79472C' },
  badgeNeutral: { backgroundColor: '#ECEAE2' },
  drawerOverlay: { flex: 1, backgroundColor: '#122F2870', alignItems: 'flex-end' },
  drawer: { width: '100%', flex: 1, backgroundColor: colors.paper },
  drawerWide: { maxWidth: 540, borderLeftWidth: 1, borderColor: colors.line },
  drawerHeading: { paddingHorizontal: 21, paddingVertical: 16, borderBottomWidth: 1, borderColor: colors.line },
  drawerContent: { padding: 21, paddingBottom: 32, gap: 14 },
  feedback: { padding: 13, borderRadius: 10, backgroundColor: colors.sage, flexDirection: 'row', alignItems: 'center', gap: 9 },
  feedbackError: { backgroundColor: '#FAECE6' },
  inputError: { borderColor: colors.error },
  fieldError: { color: colors.error, fontSize: 12, lineHeight: 17 },
  toolbar: { padding: 13, borderRadius: 12, backgroundColor: '#F1F2E9', gap: 12 },
  periodEntry: { flexBasis: 220, flexGrow: 1 },
});

const marks: Record<string, string> = {
  Overview: '◈', People: '◉', Leave: '↗', Calendar: '▦', Approvals: '✓',
  Contracts: '▤', Payroll: '▣', Activity: '∿', Workspace: '⚙',
};

export function Brand({ dark = false }: { dark?: boolean }) {
  return <View style={internal.brand} accessible accessibilityLabel="easyHR">
    <View style={internal.mark}>
      <View style={internal.markWide} /><View style={internal.markShort} />
    </View>
    <Text style={[internal.wordmark, dark && internal.wordmarkLight]}>easy<Text style={{ color: dark ? colors.lime : colors.copper }}>HR</Text></Text>
  </View>;
}

export function Rings() {
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={internal.art}>
    <View style={[internal.ring, { width: 252, height: 252 }]} />
    <View style={[internal.ring, { width: 204, height: 204 }]} />
    <View style={[internal.ring, { width: 156, height: 156 }]} />
    <View style={[internal.ring, { width: 108, height: 108 }]} />
    <View style={internal.orbit} />
  </View>;
}

export function AuthCover({ wide }: { wide: boolean }) {
  return <View style={[internal.cover, wide && internal.coverWide]}>
    <Rings />
    <Brand dark />
    <View style={{ gap: 9, maxWidth: 320 }}>
      <Text style={[internal.coverTitle, wide && internal.coverTitleWide]}>Your people workspace.</Text>
      {wide && <Text style={s.heroMeta}>Manage your team, leave, contracts and payroll in one place.</Text>}
    </View>
  </View>;
}

const navigationGroups = [
  { label: 'Overview', items: ['Overview'] },
  { label: 'People', items: ['People', 'Leave', 'Calendar', 'Approvals', 'Contracts'] },
  { label: 'Pay', items: ['Payroll'] },
  { label: 'Workspace', items: ['Activity', 'Workspace', 'Settings'] },
];
const navigationAliases: Record<string, string> = {
  Overview: 'dashboard today', People: 'staff files employee directory', Settings: 'company profile numbering pay points',
};

export function WorkspaceNav({ tabs, active, count, wide, onSelect }: {
  tabs: string[]; active: string; count: number; wide: boolean; onSelect: (name: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const primary = tabs.slice(0, 3);
  const more = tabs.slice(3);
  const activeMore = more.includes(active);
  function closeMenu() {
    setMenuOpen(false);
    setQuery('');
  }
  function item(name: string, compact = false) {
    return <Pressable key={name} accessibilityRole="button"
    accessibilityState={{ selected: active === name }}
    accessibilityLabel={name === 'Approvals' && count ? `Approvals, ${count} pending` : name}
    onPress={() => { closeMenu(); onSelect(name); }}
    style={({ pressed }) => [compact ? internal.mobileItem : internal.navItem, active === name && internal.navActive, pressed && s.pressed]}>
    <Text accessibilityElementsHidden style={[internal.navIcon, active === name && internal.navActiveText]}>{marks[name] ?? '⚙'}</Text>
    <Text style={[internal.navLabel, active === name && internal.navActiveText]}>{name}</Text>
    {name === 'Approvals' && !!count && <Text style={internal.navCount}>{count}</Text>}
    </Pressable>;
  }
  const groups = navigationGroups.map(group => ({
    ...group,
    items: group.items.filter(name => tabs.includes(name) &&
      `${name} ${navigationAliases[name] ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())),
  })).filter(group => group.items.length);
  const search = <TextInput accessibilityLabel="Search workspace sections" placeholder="Find a section"
    placeholderTextColor="#B7CDCA" value={query} onChangeText={setQuery} autoCorrect={false}
    style={internal.navSearch} />;
  const sections = <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={internal.railList}>
    {groups.map(group => <View key={group.label}>
      <Text accessibilityRole="header" style={internal.navGroup}>{group.label}</Text>
      {group.items.map(name => item(name))}
    </View>)}
    {!groups.length && <Text style={internal.navGroup}>{tabs.length ? 'No matching sections' : 'No workspace sections'}</Text>}
  </ScrollView>;
  return wide ? <View style={internal.rail}>
    <Brand dark />
    {search}
    {sections}
  </View> : <View style={internal.mobileBar}>
    <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={closeMenu}>
      <View style={internal.menuBackdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss menu" style={StyleSheet.absoluteFill} onPress={closeMenu} />
        <View accessibilityViewIsModal style={internal.mobileMenu}>
          <View style={internal.menuHeader}><Brand dark /><Button label="Close" secondary onPress={closeMenu} /></View>
          {search}
          {sections}
        </View>
      </View>
    </Modal>
    <View style={internal.mobileList}>
      {primary.map(name => item(name, true))}
      {!!more.length && <Pressable accessibilityRole="button" accessibilityLabel="Open workspace menu"
        accessibilityState={{ expanded: menuOpen, selected: activeMore }} onPress={() => setMenuOpen(true)}
        style={({ pressed }) => [internal.mobileItem, activeMore && internal.navActive, pressed && s.pressed]}>
        <Text style={[internal.navIcon, activeMore && internal.navActiveText]}>{menuOpen ? '⌄' : '⋯'}</Text>
        <Text style={[internal.navLabel, activeMore && internal.navActiveText]}>Menu</Text>
      </Pressable>}
    </View>
  </View>;
}

const internal = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wordmark: { color: colors.ink, fontWeight: '800', fontSize: 25, letterSpacing: -1 },
  wordmarkLight: { color: colors.paper },
  mark: { width: 33, height: 33, borderRadius: 9, backgroundColor: colors.lime, justifyContent: 'center', alignItems: 'center', gap: 4 },
  markWide: { height: 4, width: 16, backgroundColor: colors.forest, borderRadius: 5, transform: [{ rotate: '-22deg' }] },
  markShort: { height: 4, width: 11, backgroundColor: colors.forest, borderRadius: 5, transform: [{ rotate: '-22deg' }] },
  cover: { overflow: 'hidden', backgroundColor: colors.forest, minHeight: 172, gap: 25, padding: 24, justifyContent: 'space-between' },
  coverWide: { flexBasis: '46%', padding: 39 },
  coverTitle: { color: colors.paper, fontFamily: serif, fontSize: 31, letterSpacing: -0.8 },
  coverTitleWide: { fontSize: 54, lineHeight: 57, letterSpacing: -2 },
  art: { position: 'absolute', right: -51, top: -53, width: 252, height: 252, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-18deg' }] },
  ring: { position: 'absolute', borderWidth: 1, borderColor: '#BBD3BD55', borderRadius: 140 },
  orbit: { position: 'absolute', right: 38, bottom: 41, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.lime },
  rail: { width: 214, backgroundColor: colors.forestDark, padding: 17, paddingTop: 25, gap: 16 },
  railList: { gap: 12, paddingBottom: 14 },
  navSearch: { minHeight: 44, color: colors.paper, backgroundColor: '#24483D', borderRadius: 10, paddingHorizontal: 11 },
  navGroup: { color: '#B7CDCA', fontSize: 12, fontWeight: '700', paddingHorizontal: 11, paddingVertical: 6 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 44, paddingHorizontal: 11, borderRadius: 9 },
  mobileBar: { backgroundColor: colors.forestDark },
  mobileList: { flexDirection: 'row', gap: 4, paddingHorizontal: 8, paddingVertical: 6 },
  mobileItem: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 1, minHeight: 49, borderRadius: 8 },
  menuBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#10251E77', padding: 12 },
  mobileMenu: { maxHeight: '90%', padding: 14, gap: 12, backgroundColor: colors.forestDark, borderRadius: 16 },
  menuHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  navIcon: { color: '#B7CDCA', width: 20, textAlign: 'center', fontSize: 17 },
  navLabel: { color: '#E0EDE4', fontSize: 13, fontWeight: '600' },
  navActive: { backgroundColor: colors.lime },
  navActiveText: { color: colors.forestDark },
  navCount: { backgroundColor: colors.paper, color: colors.forestDark, borderRadius: 12, fontSize: 11, paddingHorizontal: 6, paddingVertical: 2, fontWeight: '700' },
});

export function Button({ label, onPress, disabled = false, secondary = false, selected }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean; selected?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.button, secondary && s.secondary, selected && s.filterSelected, disabled && s.disabled, pressed && s.pressed]}>
    <Text style={[s.buttonText, secondary && s.secondaryText, selected && s.filterText]}>{label}</Text>
  </Pressable>;
}
export function Field({ label, value, onChange, secure = false, error, inputMode }: {
  label: string; value: string; onChange: (v: string) => void; secure?: boolean;
  error?: string; inputMode?: 'decimal' | 'numeric' | 'email' | 'tel';
}) {
  const [focused, setFocused] = useState(false);
  return <View style={{ gap: 6 }}>
    <Text style={s.label}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} secureTextEntry={secure}
      inputMode={inputMode} accessibilityHint={error}
      autoCapitalize="none" autoCorrect={false} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      selectionColor={colors.sage} style={[s.input, focused && s.inputFocused, error && s.inputError]} />
    {!!error && <Text accessibilityRole="alert" style={s.fieldError}>{error}</Text>}
  </View>;
}
