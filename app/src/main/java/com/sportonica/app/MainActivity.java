package com.sportonica.app;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Draw behind the system bars on every Android version, not just
        // 15+ where it's forced — Play Console asks for this. Capacitor's
        // SystemBars pads the WebView clear of the bars, and the paper
        // windowBackground (styles.xml) shows through behind them. Must
        // run after super.onCreate: BridgeActivity swaps the splash launch
        // theme for AppTheme.NoActionBar there, and touching the window
        // first would freeze the splash drawable in as its background.
        EdgeToEdge.enable(this);
        // A real app's layout doesn't pinch-zoom/pan like a webpage. The web
        // layer already locks this via a native-only viewport meta tag
        // (CapacitorBridge.tsx); disable it here too at the WebView level
        // so it holds regardless of how the page's meta tag is applied.
        this.bridge.getWebView().getSettings().setBuiltInZoomControls(false);
        this.bridge.getWebView().getSettings().setSupportZoom(false);
        this.bridge.getWebView().getSettings().setDisplayZoomControls(false);
    }
}
