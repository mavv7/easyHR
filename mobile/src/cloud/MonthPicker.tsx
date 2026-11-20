import { DateField } from './DateField';
import { View } from 'react-native';
import { Text } from '../typography';
import { calendarMonth, companyDateKey } from './leaveCalendar';
import { Button, s } from './workspaceDesign';

export function monthName(period: string) {
  return new Date(period + '-01T00:00:00Z').toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

export function MonthPicker({ period, onChange, disabled }: {
  period: string; onChange: (month: string) => void; disabled?: boolean;
}) {
  return <View style={s.toolbar}>
    <Text accessibilityLiveRegion="polite" style={s.heading}>{monthName(period)}</Text>
    <View style={s.row}>
      <Button label="Previous month" secondary disabled={disabled || period === '0001-01'} onPress={() => onChange(calendarMonth(period, -1))} />
      <Button label="Next month" secondary disabled={disabled || period === '9999-12'} onPress={() => onChange(calendarMonth(period, 1))} />
      <Button label="This month" secondary disabled={disabled} onPress={() => onChange(companyDateKey().slice(0, 7))} />
    </View>
    <DateField label="Jump to month" monthOnly value={period} onChange={onChange} disabled={disabled} />
  </View>;
}
