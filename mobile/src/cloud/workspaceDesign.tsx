import { type ReactNode, useState } from 'react';
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const colors = {
  canvas: '#F8F5EF', paper: '#FFFDF9', ink: '#2B211C', muted: '#665D53',
  orange: '#ED631C', orangeLight: '#FFF0E5', lime: '#DDEB9D', limeLight: '#F0F5D8',
  copper: '#9B3C14', line: '#E9E0D6', error: '#A23026',
};

const serif = Platform.select({ web: 'Georgia, serif', ios: 'Georgia', default: 'serif' });
export const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  body: { flex: 1, minWidth: 0 },
  frame: { flex: 1 },
  desktop: { flexDirection: 'row' },
  content: { padding: 16, paddingBottom: 32, gap: 16, maxWidth: 1180, width: '100%', alignSelf: 'center' },
  contentWide: { padding: 32, paddingBottom: 48, gap: 22 },
  topbar: { backgroundColor: colors.paper, borderBottomWidth: 1, borderColor: colors.line },
  topbarInner: { width: '100%', maxWidth: 1180, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  topbarWide: { paddingHorizontal: 32 },
  topbarIdentity: { flex: 1, minWidth: 0, gap: 2 },
  topbarActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  page: { flex: 1, minWidth: 0 },
  auth: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 18 },
  authShell: { width: '100%', maxWidth: 1030, flexDirection: 'column', backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', borderRadius: 26 },
  authWide: { flexDirection: 'row', minHeight: 620 },
  authForm: { flex: 1, gap: 14, padding: 22, justifyContent: 'center' },
  authFormWide: { padding: 38 },
  title: { fontFamily: serif, fontWeight: '400', fontSize: 38, letterSpacing: -1.6, color: colors.ink },
  hero: { backgroundColor: colors.orangeLight, borderWidth: 1, borderColor: '#F0D5C2', borderRadius: 20, padding: 21, overflow: 'hidden', minHeight: 112, justifyContent: 'center', gap: 4 },
  heroWide: { minHeight: 130, padding: 26 },
  heroTitle: { color: colors.ink, fontFamily: serif, fontSize: 36, letterSpacing: -1.2, fontWeight: '400' },
  heroMeta: { color: '#603A29', fontSize: 13, lineHeight: 20 },
  heading: { fontSize: 21, color: colors.ink, letterSpacing: -0.45, fontWeight: '700' },
  subtitle: { fontSize: 14, color: colors.muted, lineHeight: 22 },
  small: { fontSize: 12, color: colors.muted, lineHeight: 19 },
  label: { fontSize: 13, color: colors.ink, fontWeight: '600' },
  card: { padding: 20, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 18, gap: 17 },
  cardHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  nestedCard: { padding: 16, backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line, borderRadius: 13, gap: 10 },
  form: { backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line, padding: 16, borderRadius: 13, gap: 14 },
  input: { borderWidth: 1, borderColor: '#D9CEC1', backgroundColor: '#FFFFFF', paddingHorizontal: 13, paddingVertical: 11, borderRadius: 10, minHeight: 46, color: colors.ink, fontSize: 15 },
  inputFocused: { borderColor: colors.copper, backgroundColor: '#FFFFFF' },
  button: { minHeight: 44, paddingHorizontal: 15, paddingVertical: 10, backgroundColor: colors.orange, borderWidth: 1, borderColor: colors.orange, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontWeight: '700', color: colors.ink, fontSize: 13, textAlign: 'center' },
  secondary: { backgroundColor: colors.paper, borderColor: '#D9CEC1' },
  secondaryText: { color: colors.ink },
  filterSelected: { backgroundColor: colors.limeLight, borderColor: '#8E9F51' },
  filterText: { color: colors.ink },
  pressed: { opacity: 0.76 },
  disabled: { opacity: 0.46 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 9 },
  fieldRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  fieldColumn: { flexGrow: 1, flexBasis: 230, minWidth: 0 },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 15, borderBottomWidth: 1, borderColor: colors.line },
  avatar: { width: 39, height: 39, borderRadius: 12, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.ink, fontWeight: '700', fontSize: 13 },
  identity: { flex: 1, minWidth: 150, gap: 2 },
  error: { color: colors.error, lineHeight: 20 },
  message: { backgroundColor: colors.limeLight, padding: 13, borderRadius: 10, color: colors.ink, lineHeight: 21 },
  loading: { padding: 30, color: colors.ink },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metric: { flexGrow: 1, flexBasis: 138, minWidth: 0, gap: 5, backgroundColor: colors.limeLight, borderRadius: 13, padding: 15 },
  metricValue: { color: colors.ink, fontFamily: serif, fontSize: 31, fontVariant: ['tabular-nums'] },
  badge: { alignSelf: 'flex-start', borderRadius: 20, paddingVertical: 5, paddingHorizontal: 9, backgroundColor: colors.limeLight },
  badgeText: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  badgePending: { backgroundColor: colors.orangeLight },
  badgePendingText: { color: colors.copper },
  badgeNeutral: { backgroundColor: '#ECEAE2' },
  drawerOverlay: { flex: 1, backgroundColor: '#2B211C70', alignItems: 'flex-end' },
  drawer: { width: '100%', flex: 1, backgroundColor: colors.paper },
  drawerWide: { maxWidth: 540, borderLeftWidth: 1, borderColor: colors.line },
  drawerHeading: { paddingHorizontal: 21, paddingVertical: 16, borderBottomWidth: 1, borderColor: colors.line },
  drawerContent: { padding: 21, paddingBottom: 32, gap: 14 },
  feedback: { padding: 13, borderRadius: 10, backgroundColor: colors.limeLight, flexDirection: 'row', alignItems: 'center', gap: 9 },
  feedbackError: { backgroundColor: '#FAECE6' },
  inputError: { borderColor: colors.error },
  fieldError: { color: colors.error, fontSize: 12, lineHeight: 17 },
  toolbar: { padding: 13, borderRadius: 12, backgroundColor: colors.canvas, gap: 12 },
  periodEntry: { flexBasis: 220, flexGrow: 1 },
});

export function Brand({ compact = false }: { compact?: boolean }) {
  return <View style={internal.brand} accessible accessibilityLabel="easyHR">
    <Image source={require('../../assets/favicon.png')} style={internal.mark} />
    {!compact && <Text style={internal.wordmark}>easy<Text style={internal.wordmarkAccent}>HR</Text></Text>}
  </View>;
}

export function Rings() {
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={internal.art}>
    {[252, 204, 156, 108].map(size => <View key={size} style={[internal.ring, { width: size, height: size }]} />)}
    <View style={internal.orbit} />
  </View>;
}

export function AuthCover({ wide }: { wide: boolean }) {
  return <View style={[internal.cover, wide && internal.coverWide]}>
    <Rings />
    <Brand />
    <View style={{ gap: 9, maxWidth: 320 }}>
      <Text style={[internal.coverTitle, wide && internal.coverTitleWide]}>Your people workspace.</Text>
      {wide && <Text style={s.heroMeta}>Manage your team, leave, contracts and payroll in one place.</Text>}
    </View>
  </View>;
}

const navigationGroups = [
  { label: 'Home', items: ['Overview', 'Today'] },
  { label: 'People', items: ['People', 'Leave', 'Calendar', 'Approvals', 'Attendance', 'Contracts'] },
  { label: 'Pay and compliance', items: ['Payroll', 'Compliance'] },
  { label: 'Workspace', items: ['Activity', 'Workspace', 'Settings'] },
];
const marks: Record<string, string> = {
  Overview: '\u25C8', Today: '\u25C8', People: '\u25C9', Leave: '\u2197', Calendar: '\u25A6', Approvals: '\u2713',
  Contracts: '\u25A4', Payroll: '\u25A3', Activity: '\u223F', Workspace: '\u25CE', Settings: '\u2699',
  Attendance: '\u25F7', Compliance: '\u25C7',
};
const navigationAliases: Record<string, string> = {
  Overview: 'dashboard today', Today: 'dashboard overview', People: 'staff files employee directory',
  Settings: 'company profile numbering pay points',
};

export function WorkspaceNav({ tabs, active, count, wide, company, countTab = 'Approvals', onSelect }: {
  tabs: string[]; active: string; count: number; wide: boolean; company?: string;
  countTab?: string; onSelect: (name: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const primary = tabs.slice(0, 3);
  const hasMore = tabs.length > primary.length;
  const activeMore = tabs.includes(active) && !primary.includes(active);
  const searchTerm = query.trim().toLowerCase();

  function closeMenu() {
    setMenuOpen(false);
    setQuery('');
  }
  function item(name: string, compact = false) {
    const selected = active === name;
    const pending = name === countTab && count > 0;
    return <Pressable key={name} accessibilityRole="button" accessibilityState={{ selected }}
      accessibilityLabel={pending ? name + ', ' + count + ' pending' : name}
      onPress={() => { closeMenu(); onSelect(name); }}
      style={({ pressed }) => [compact ? internal.mobileItem : internal.navItem, selected && internal.navActive, pressed && s.pressed]}>
      <View style={[internal.navIconTile, selected && internal.navIconSelected]}>
        <Text accessibilityElementsHidden importantForAccessibility="no" style={[internal.navIcon, selected && internal.navActiveText]}>{marks[name]}</Text>
      </View>
      <Text numberOfLines={1} style={[internal.navLabel, !compact && internal.railLabel, selected && internal.navActiveText]}>{name}</Text>
      {!compact && pending && <Text style={internal.navCount}>{count}</Text>}
    </Pressable>;
  }

  const groups = navigationGroups.map(group => ({
    ...group,
    items: group.items.filter(name => tabs.includes(name) &&
      [name, navigationAliases[name]].join(' ').toLowerCase().includes(searchTerm)),
  })).filter(group => group.items.length);
  const search = <TextInput accessibilityLabel="Search workspace sections" placeholder="Find a section"
    placeholderTextColor={colors.muted} value={query} onChangeText={setQuery} autoCorrect={false}
    style={internal.navSearch} />;
  const companyLabel = company && <Text numberOfLines={2} style={internal.company}>{company}</Text>;
  const sections = <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={internal.railList}>
    {groups.map(group => <View key={group.label}>
      <Text accessibilityRole="header" style={internal.navGroup}>{group.label}</Text>
      {group.items.map(name => item(name))}
    </View>)}
    {!groups.length && <Text style={internal.navGroup}>{tabs.length ? 'No matching sections' : 'No workspace sections'}</Text>}
  </ScrollView>;

  if (wide) return <View style={internal.rail}>
    <View style={internal.railBrand}><Brand /></View>
    {companyLabel}
    {search}
    {sections}
  </View>;

  return <View style={internal.mobileBar}>
    <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={closeMenu}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={internal.menuBackdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss menu" style={StyleSheet.absoluteFill} onPress={closeMenu} />
        <SafeAreaView edges={['top', 'bottom']} accessibilityViewIsModal style={internal.mobileMenu}>
          <View style={internal.menuHeader}><Brand /><Button label="Close" secondary onPress={closeMenu} /></View>
          {companyLabel}
          {search}
          {sections}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
    <View style={internal.mobileList}>
      {primary.map(name => item(name, true))}
      {hasMore && <Pressable accessibilityRole="button" accessibilityLabel="Open workspace menu"
        accessibilityState={{ expanded: menuOpen, selected: activeMore }} onPress={() => setMenuOpen(true)}
        style={({ pressed }) => [internal.mobileItem, activeMore && internal.navActive, pressed && s.pressed]}>
        <View style={[internal.navIconTile, activeMore && internal.navIconSelected]}>
          <Text style={[internal.navIcon, activeMore && internal.navActiveText]}>{'\u2630'}</Text>
        </View>
        <Text style={[internal.navLabel, activeMore && internal.navActiveText]}>Menu</Text>
      </Pressable>}
    </View>
  </View>;
}

const internal = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  wordmark: { color: colors.ink, fontWeight: '800', fontSize: 25, letterSpacing: -1 },
  wordmarkAccent: { color: colors.copper },
  mark: { width: 38, height: 38 },
  cover: { overflow: 'hidden', backgroundColor: colors.orangeLight, minHeight: 168, gap: 25, padding: 24, justifyContent: 'space-between' },
  coverWide: { flexBasis: '43%', padding: 36 },
  coverTitle: { color: colors.ink, fontFamily: serif, fontSize: 31, letterSpacing: -0.8 },
  coverTitleWide: { fontSize: 54, lineHeight: 57, letterSpacing: -2 },
  art: { position: 'absolute', right: -45, top: -53, width: 252, height: 252, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderWidth: 1, borderColor: '#ED631C33', borderRadius: 140 },
  orbit: { position: 'absolute', right: 38, bottom: 41, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.lime },
  rail: { width: 224, backgroundColor: colors.paper, borderRightWidth: 1, borderColor: colors.line, padding: 15, paddingTop: 18, gap: 13 },
  railBrand: { paddingHorizontal: 7, paddingBottom: 4 },
  company: { backgroundColor: colors.canvas, color: colors.ink, padding: 11, borderRadius: 10, fontSize: 13, fontWeight: '600' },
  railList: { gap: 11, paddingBottom: 14 },
  navSearch: { minHeight: 44, color: colors.ink, backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 11 },
  navGroup: { color: colors.muted, fontSize: 11, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 6, letterSpacing: 0.4 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 44, paddingHorizontal: 8, borderRadius: 10 },
  mobileBar: { backgroundColor: colors.paper, borderTopWidth: 1, borderColor: colors.line },
  mobileList: { flexDirection: 'row', gap: 5, paddingHorizontal: 10, paddingVertical: 5 },
  mobileItem: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 54, borderRadius: 10 },
  menuBackdrop: { flex: 1, alignItems: 'flex-start', backgroundColor: '#2B211C70' },
  mobileMenu: { width: '88%', maxWidth: 360, flex: 1, paddingHorizontal: 14, paddingTop: 12, gap: 12, backgroundColor: colors.paper },
  menuHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  navIconTile: { width: 32, height: 27, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  navIconSelected: { backgroundColor: colors.lime },
  navIcon: { color: colors.muted, fontSize: 17, lineHeight: 22 },
  navLabel: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  railLabel: { flex: 1, fontSize: 13 },
  navActive: { backgroundColor: colors.orangeLight },
  navActiveText: { color: colors.copper },
  navCount: { backgroundColor: colors.lime, color: colors.ink, borderRadius: 12, fontSize: 11, paddingHorizontal: 6, paddingVertical: 2, fontWeight: '700' },
});

export function Button({ label, onPress, disabled = false, secondary = false, selected }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean; selected?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.button, secondary && s.secondary, selected && s.filterSelected, disabled && s.disabled, pressed && s.pressed]}>
    <Text style={[s.buttonText, secondary && s.secondaryText, selected && s.filterText]}>{label}</Text>
  </Pressable>;
}

export function FieldPair({ first, second }: { first: ReactNode; second: ReactNode }) {
  return <View style={s.fieldRow}>
    <View style={s.fieldColumn}>{first}</View>
    <View style={s.fieldColumn}>{second}</View>
  </View>;
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
      selectionColor={colors.lime} style={[s.input, focused && s.inputFocused, error && s.inputError]} />
    {!!error && <Text accessibilityRole="alert" style={s.fieldError}>{error}</Text>}
  </View>;
}
