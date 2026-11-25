import { forwardRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, type PressableProps, type TextInputProps } from 'react-native';
import { colors } from '../theme';

export const isAndroidTv = Platform.OS === 'android' && Platform.isTV;

function TvPressable({ style, accessible, focusable, disabled, onFocus, onBlur, ...props }: PressableProps) {
  const [focused, setFocused] = useState(false);
  const enabled = !disabled && focusable !== false && accessible !== false;
  return <Pressable
    {...props}
    accessible={enabled}
    focusable={enabled}
    disabled={disabled}
    onFocus={event => { setFocused(true); onFocus?.(event); }}
    onBlur={event => { setFocused(false); onBlur?.(event); }}
    style={state => [
      typeof style === 'function' ? style(state) : style,
      enabled && s.target,
      enabled && focused && s.focus,
    ]}
  />;
}

const TvTextInput = forwardRef<TextInput, TextInputProps>(function TvTextInput({ style, onFocus, onBlur, ...props }, ref) {
  const [focused, setFocused] = useState(false);
  return <TextInput
    {...props}
    ref={ref}
    onFocus={event => { setFocused(true); onFocus?.(event); }}
    onBlur={event => { setFocused(false); onBlur?.(event); }}
    style={[style, s.target, focused && s.focus]}
  />;
});

export const FocusPressable = isAndroidTv ? TvPressable : Pressable;
export const FocusInput = isAndroidTv ? TvTextInput : TextInput;

const s = StyleSheet.create({
  target: { minWidth: 44, minHeight: 44 },
  focus: { outlineWidth: 3, outlineOffset: 1, outlineColor: colors.primary, outlineStyle: 'solid' },
});
