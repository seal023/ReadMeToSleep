import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useLanguage } from '../../hooks/useLanguage';
import { ClayIcon } from '../../components/ui/ClayIcon';

export default function TabsLayout() {
  const { t } = useLanguage();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#F2827F',
        tabBarInactiveTintColor: '#BDBDBD',
        tabBarStyle: {
          backgroundColor: '#FFF8F0',
          height: 80,
          paddingBottom: 20,
          borderTopColor: '#F5E6D3',
          borderTopWidth: 1,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarLabel: t('tab.home'),
          tabBarIcon: () => <ClayIcon name="raccoon" size={26} />,
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          tabBarLabel: t('tab.create'),
          tabBarIcon: () => <ClayIcon name="starBig" size={26} />,
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          tabBarLabel: t('tab.library'),
          tabBarIcon: () => <ClayIcon name="book" size={26} />,
        }}
      />
      <Tabs.Screen
        name="my-stories"
        options={{
          tabBarLabel: t('tab.myStories'),
          tabBarIcon: () => <ClayIcon name="trophy" size={26} />,
        }}
      />
      <Tabs.Screen
        name="record"
        options={{
          tabBarLabel: t('tab.record'),
          tabBarIcon: () => <ClayIcon name="mic" size={26} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          tabBarLabel: t('tab.settings'),
          tabBarIcon: () => <Text style={{ fontSize: 22 }}>⚙️</Text>,
        }}
      />
    </Tabs>
  );
}
