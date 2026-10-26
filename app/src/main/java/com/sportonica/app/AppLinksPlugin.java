package com.sportonica.app;

import android.content.Intent;
import android.content.pm.verify.domain.DomainVerificationManager;
import android.content.pm.verify.domain.DomainVerificationUserState;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Google sign-in finishes in the system browser and only gets back into
// the app through the www.sportonica.com App Link. If Android's domain
// check failed when the app was installed (or the user turned link
// handling off), the redirect stays in the browser instead. This lets the
// web layer (src/lib/capacitor/appLinks.ts) see that and send the user to
// the "Open by default" screen to allow it.
@CapacitorPlugin(name = "AppLinks")
public class AppLinksPlugin extends Plugin {
    private static final String HOST = "www.sportonica.com";

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        // Per-domain state is only readable from Android 12; older
        // versions just open the link in whatever the user picks.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            ret.put("supported", false);
            ret.put("allowed", true);
            call.resolve(ret);
            return;
        }
        boolean allowed;
        try {
            DomainVerificationManager manager = getContext().getSystemService(DomainVerificationManager.class);
            DomainVerificationUserState state = manager.getDomainVerificationUserState(getContext().getPackageName());
            Integer hostState = state == null ? null : state.getHostToStateMap().get(HOST);
            allowed = state != null
                && state.isLinkHandlingAllowed()
                && hostState != null
                && hostState != DomainVerificationUserState.DOMAIN_STATE_NONE;
        } catch (Exception e) {
            // Can't tell — don't nag the user over it.
            allowed = true;
        }
        ret.put("supported", true);
        ret.put("allowed", allowed);
        call.resolve(ret);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Uri pkg = Uri.parse("package:" + getContext().getPackageName());
        Intent intent = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            ? new Intent(Settings.ACTION_APP_OPEN_BY_DEFAULT_SETTINGS, pkg)
            : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't open settings");
        }
    }
}
