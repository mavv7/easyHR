import { useState } from 'react';
import { Text, View } from 'react-native';
import { calendarMonth, companyDateKey, isDateKey } from './leaveCalendar';
import { Button, Field, s } from './workspaceDesign';

export function monthName(period: string) {
  return new Date(period + '-01T00:00:00Z').toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

export function MonthPicker({ period, onChange, disabled }: {
  period: string; onChange: (month: string) => void; disabled?: boolean;
}) {
  const [jump, setJump] = useState<string | null>(null);
  const [error, setError] = useState('');
  function choose(month: string) {
    const value = month.trim();
    if (!isDateKey(value + '-01') || value.startsWith('0000')) {
      setError('Enter a month in YYYY-MM format.');
      return;
    }
    setJump(null);
    setError('');
    onChange(value);
  }
  return <View style={s.toolbar}>
    <Text accessibilityLiveRegion="polite" style={s.heading}>{monthName(period)}</Text>
    <View style={s.row}>
      <Button label="Previous month" secondary disabled={disabled || period === '0001-01'} onPress={() => choose(calendarMonth(period, -1))} />
      <Button label="Next month" secondary disabled={disabled || period === '9999-12'} onPress={() => choose(calendarMonth(period, 1))} />
      <Button label="This month" secondary disabled={disabled} onPress={() => choose(companyDateKey().slice(0, 7))} />
      <Button label={jump === null ? 'Jump to month' : 'Close month entry'} secondary disabled={disabled} onPress={() => {
        setError('');
        setJump(jump === null ? period : null);
      }} />
    </View>
    {jump !== null && <View style={s.row}>
      <View style={s.periodEntry}>
        <Field label="Month (YYYY-MM)" value={jump} onChange={value => { setJump(value); setError(''); }} error={error} />
      </View>
      <Button label="Open month" disabled={disabled} onPress={() => choose(jump)} />
    </View>}
  </View>;
}
