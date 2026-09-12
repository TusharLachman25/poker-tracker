import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pokertracker.app',
  appName: 'Poker Tracker',
  webDir: 'dist',
  android: {
    // The app is a local bundle; nothing is fetched over plain HTTP.
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
