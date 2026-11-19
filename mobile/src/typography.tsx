import { createContext, useContext } from 'react';
import {
  StyleSheet, Text as NativeText, TextInput as NativeTextInput,
  type StyleProp, type TextInputProps, type TextProps, type TextStyle,
} from 'react-native';

export const PoppinsLoaded = createContext(false);

function usePoppins(style: StyleProp<TextStyle>): StyleProp<TextStyle> {
  const loaded = useContext(PoppinsLoaded);
  if (!loaded) return style;

  const weight = StyleSheet.flatten(style)?.fontWeight;
  const fontFamily = weight === '800' ? 'Poppins-ExtraBold'
    : weight === 'bold' || weight === '700' ? 'Poppins-Bold'
    : weight === '600' ? 'Poppins-SemiBold'
    : 'Poppins-Regular';

  // Each static face is registered under its own name.
  return [style, { fontFamily, fontWeight: 'normal' }];
}

export function Text({ style, ...props }: TextProps) {
  return <NativeText {...props} style={usePoppins(style)} />;
}

export function TextInput({ style, ...props }: TextInputProps) {
  return <NativeTextInput {...props} style={usePoppins(style)} />;
}
