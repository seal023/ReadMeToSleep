import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useLanguage } from '../../hooks/useLanguage';

export default function TabsLayout() {
  const { t } = useLanguage();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#FF6B6B',
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
          tabBarIcon: () => <Text style={{ fontSize: 22 }}>🏠</Text>,
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          tabBarLabel: t('tab.create'),
          tabBarIcon: () => <Text style={{ fontSize: 22 }}>✏️</Text>,
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          tabBarLabel: t('tab.library'),
          tabBarIcon: () => <Text style={{ fontSize: 22 }}>📚</Text>,
        }}
      />
      <Tabs.Screen
        name="my-stories"
        options={{
          tabBarLabel: t('tab.myStories'),
          tabBarIcon: () => <Text style={{ fontSize: 22 }}>📖</Text>,
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
