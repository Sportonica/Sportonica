import { Capacitor, registerPlugin } from "@capacitor/core";

// Native side: android/app/src/main/java/com/sportonica/app/AppLinksPlugin.java.
// Only in builds from 1.1 on — older installs don't have it, and every
// helper here quietly does nothing there.
interface AppLinksPlugin {
  status(): Promise<{ supported: boolean; allowed: boolean }>;
  openSettings(): Promise<void>;
}

const AppLinks = registerPlugin<AppLinksPlugin>("AppLinks");

function available() {
  return Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("AppLinks");
}

/** True when Android won't hand www.sportonica.com links to the app, so an
 *  OAuth redirect would finish in the browser instead of coming back in. */
export async function appLinksBlocked(): Promise<boolean> {
  if (!available()) return false;
  try {
    const { supported, allowed } = await AppLinks.status();
    return supported && !allowed;
  } catch {
    return false;
  }
}

/** Opens the app's "Open by default" settings screen. */
export async function openAppLinkSettings(): Promise<void> {
  if (!available()) return;
  await AppLinks.openSettings().catch(() => {});
}
