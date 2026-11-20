import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../typography';
import { calendarDays, calendarMonth, companyDateKey } from './leaveCalendar';
import { Button, colors, s } from './workspaceDesign';

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatDate(value: string, options: Intl.DateTimeFormatOptions) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', { ...options, timeZone: 'UTC' });
}

export function DateField({ label, value, onChange, monthOnly = false, clearable = false, disabled, error }: {
  label: string; value: string; onChange: (value: string) => void;
  monthOnly?: boolean; clearable?: boolean; disabled?: boolean; error?: string;
}) {
  const [cursor, setCursor] = useState('');
  const [showMonths, setShowMonths] = useState(false);
  const year = cursor.slice(0, 4);
  const days = cursor && !showMonths ? calendarDays(cursor, []) : [];
  const today = companyDateKey();
  const display = value ? formatDate(monthOnly ? value + '-01' : value,
    { year: 'numeric', month: 'long', day: monthOnly ? undefined : 'numeric' }) : monthOnly ? 'Select month' : 'Select date';

  function choose(next: string) {
    onChange(next);
    setCursor('');
  }

  return <View style={{ gap: 6 }}>
    <Text style={s.label}>{label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${display}`}
      accessibilityState={{ expanded: !!cursor, disabled }} disabled={disabled} style={s.input}
      onPress={() => { setCursor(cursor ? '' : (value || today).slice(0, 7)); setShowMonths(monthOnly); }}>
      <Text style={s.label}>{display}</Text>
    </Pressable>
    {!!cursor && <View style={s.toolbar}>
      <View style={s.row}>
        <Button label={showMonths ? 'Previous year' : 'Previous month'} secondary
          disabled={disabled || (showMonths ? year === '0001' : cursor === '0001-01')}
          onPress={() => setCursor(calendarMonth(cursor, showMonths ? -12 : -1))} />
        <Button label={showMonths ? 'Next year' : 'Next month'} secondary
          disabled={disabled || (showMonths ? year === '9999' : cursor === '9999-12')}
          onPress={() => setCursor(calendarMonth(cursor, showMonths ? 12 : 1))} />
      </View>
      <Text accessibilityLiveRegion="polite" style={s.heading}>{showMonths ? year :
        formatDate(cursor + '-01', { month: 'long', year: 'numeric' })}</Text>
      {!monthOnly && !showMonths && <Button label="Choose month and year" secondary disabled={disabled} onPress={() => setShowMonths(true)} />}
      {showMonths ? <View style={s.row}>
        {Array.from({ length: 12 }, (_, index) => {
          const month = year + '-' + String(index + 1).padStart(2, '0');
          return <Button key={month} label={formatDate(month + '-01', { month: 'short' })} secondary
            selected={month === (value || cursor).slice(0, 7)} disabled={disabled}
            onPress={() => { if (monthOnly) choose(month); else { setCursor(month); setShowMonths(false); } }} />;
        })}
      </View> : <>
        <View style={styles.week}>{weekdays.map(day => <Text key={day} style={styles.cell}>{day}</Text>)}</View>
        {Array.from({ length: days.length / 7 }, (_, week) => <View key={week} style={styles.week}>
          {days.slice(week * 7, week * 7 + 7).map((day, weekday) => day ? <Pressable key={day.date} accessibilityRole="button"
            accessibilityLabel={formatDate(day.date, { dateStyle: 'full' })}
            accessibilityState={{ selected: day.date === value, disabled }} disabled={disabled}
            style={[styles.cell, styles.day, day.date === value && styles.selected]} onPress={() => choose(day.date)}>
            <Text style={s.label}>{Number(day.date.slice(-2))}</Text>
          </Pressable> : <View key={weekday} style={styles.cell} />)}
        </View>)}
      </>}
      <View style={s.row}>
        <Button label={monthOnly ? 'This month' : 'Today'} secondary disabled={disabled}
          onPress={() => choose(monthOnly ? today.slice(0, 7) : today)} />
        {clearable && !!value && <Button label="Clear" secondary disabled={disabled} onPress={() => choose('')} />}
        <Button label="Cancel" secondary onPress={() => setCursor('')} />
      </View>
    </View>}
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  week: { flexDirection: 'row' },
  cell: { flex: 1, textAlign: 'center', color: colors.muted },
  day: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  selected: { backgroundColor: colors.orange },
});
