import type { CapacitorConfig } from '@capacitor/cli';

// This app can't be statically bundled onto the device — it's a full
// Next.js SSR app (Server Components hitting Supabase live, Server
// Actions, cookie-based auth middleware on every request). `webDir`
// above is required by the CLI but unused: the native shell loads the
// live production URL instead of local files.
const config: CapacitorConfig = {
  appId: 'com.sportonica.app',
  appName: 'Sportonica',
  webDir: 'public',
  // The WebView's own background while the remote page loads after the
  // splash lifts: paper, same as styles.xml and layout.tsx's themeColor.
  backgroundColor: '#F2EDE6',
  server: {
    url: 'https://www.sportonica.com',
    androidScheme: 'https',
    // Bundled (webDir) page shown when the site can't load — no network,
    // DNS, server down — instead of the WebView's "Webpage not available".
    errorPath: 'app-offline.html',
  },
  plugins: {
    SplashScreen: {
      // CapacitorBridge.tsx calls SplashScreen.hide() as soon as the
      // remote page has mounted; launchShowDuration is only the ceiling.
      // Never hold it indefinitely (launchAutoHide: false): on Android 12+
      // the splash blocks the activity's first draw, so on a slow
      // connection (or none) a tap lands on "no focused window" and
      // Android raises an ANR after 5 s — Play vitals showed exactly that.
      launchAutoHide: true,
      launchShowDuration: 3000,
      backgroundColor: '#0B0D11',
      androidScaleType: 'CENTER_INSIDE',
    },
  },
};

export default config;
