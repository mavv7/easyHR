import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { PoppinsLoaded } from '../typography';

export default function Layout() {
  const [loaded, error] = useFonts({
    'Poppins-Regular': require('../../assets/fonts/Poppins-Regular.ttf'),
    'Poppins-SemiBold': require('../../assets/fonts/Poppins-SemiBold.ttf'),
    'Poppins-Bold': require('../../assets/fonts/Poppins-Bold.ttf'),
    'Poppins-ExtraBold': require('../../assets/fonts/Poppins-ExtraBold.ttf'),
  });

  if (!loaded && !error) return null;
  return <PoppinsLoaded.Provider value={loaded}>
    <Stack screenOptions={{ headerShown: false }} />
  </PoppinsLoaded.Provider>;
}
