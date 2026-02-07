import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.heartspro.game',
  appName: 'Hearts Pro',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  android: {
    buildOptions: {
      keystorePath: 'release-key.keystore',
      keystoreAlias: 'key0',
    }
  },
  plugins: {
    // These will be used when you install the AdMob/Play Services plugins locally
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: "#0b2e13",
      showSpinner: true,
      androidSpinnerStyle: "large",
      spinnerColor: "#eab308"
    }
  }
};

export default config;