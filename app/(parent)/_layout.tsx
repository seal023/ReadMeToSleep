import { Stack } from 'expo-router';

export default function ParentLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="hub" />
      <Stack.Screen name="sensitive-words" />
      <Stack.Screen name="child-recordings" />
      <Stack.Screen name="voice-clone" />
      <Stack.Screen name="subscription" />
      <Stack.Screen name="statistics" />
    </Stack>
  );
}
