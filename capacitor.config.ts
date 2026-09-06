import type { CapacitorConfig } from '@capacitor/cli';

// Native wrapper configuration (iOS / Android). Build the web app first: `npm run build`.
// For online play from the native app, build with VITE_SERVER_URL=wss://your-server/ws.
const config: CapacitorConfig = {
  appId: 'com.fireisle.app',
  appName: 'Fire Isle',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  ios: { contentInset: 'never' },
};

export default config;
