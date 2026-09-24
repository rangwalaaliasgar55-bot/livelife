import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.aurelion.sim",
  appName: "Aurelion",
  webDir: "out",
  server: {
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: "#07080c",
      showSpinner: false,
    },
    Keyboard: {
      appId: "com.aurelion.sim",
    },
  },
};

export default config;
