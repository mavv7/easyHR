import { Pressable, View } from 'react-native';
import { Text } from '../typography';
import { router, useLocalSearchParams } from 'expo-router';
import Demo from '../App';
import CloudApp from '../cloud/CloudApp';

export default function Index() {
  const { demo } = useLocalSearchParams<{ demo?: string }>();
  if (demo === 'true') return <View style={{ flex: 1 }}><Pressable accessibilityRole="button" onPress={() => router.setParams({ demo: 'false' })} style={{ backgroundColor: '#EAF2DA', padding: 14 }}><Text style={{ textAlign: 'center' }}>Fictional demo · Return to sign in</Text></Pressable><Demo /></View>;
  return <CloudApp onDemo={() => router.setParams({ demo: 'true' })} />;
}
