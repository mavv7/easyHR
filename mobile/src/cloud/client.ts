import 'react-native-url-polyfill/auto';
import { createClient, processLock } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const configured = !!url && !!key && !url.includes('YOUR_PROJECT') && !key.includes('REPLACE_ME');
if (key?.startsWith('sb_secret_')) throw new Error('Use a publishable key, never a Supabase secret key in the app.');

// Native session tokens are stored in Keychain/Keystore. HR records remain in memory.
// Browser preview uses sessionStorage, so its session ends when the tab is closed.
const storage = {
  getItem: async (name: string) => Platform.OS === 'web'
    ? (typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(name))
    : SecureStore.getItemAsync(name),
  setItem: async (name: string, value: string) => {
    if (Platform.OS === 'web') { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(name, value); }
    else await SecureStore.setItemAsync(name, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  },
  removeItem: async (name: string) => {
    if (Platform.OS === 'web') { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(name); }
    else await SecureStore.deleteItemAsync(name);
  },
};
export const supabase = configured ? createClient(url!, key!, {
  auth: { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, lock: processLock },
}) : null;

// A verified recovery code grants a temporary session. Keep it out of the
// workspace client's session store and auth state listener.
export function createPasswordRecoveryClient() {
  return createClient(url!, key!, {
    auth: {
      storageKey: 'easyhr-password-recovery',
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
