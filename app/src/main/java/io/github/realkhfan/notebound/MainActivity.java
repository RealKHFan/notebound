package io.github.realkhfan.notebound;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Hosts the Notebound UI in a WebView that only ever shows local content.
 * Everything the UI needs from Android goes through {@link Bridge}.
 */
public final class MainActivity extends Activity {
    static final String ACTION_NEW = "io.github.realkhfan.notebound.action.NEW";
    static final String ACTION_OPEN = "io.github.realkhfan.notebound.action.OPEN";
    static final String EXTRA_KIND = "kind";
    static final String EXTRA_NOTE_ID = "noteId";
    private static final String TAG = "Notebound";

    private WebView web;
    private FrameLayout root;
    private Bridge bridge;
    private LocalContent content;
    private String pendingIntent;
    private boolean backEnabled;
    private Object backCallback;
    private long pausedAt;
    private final int[] bars = new int[4];
    private int ime;

    private static boolean crashHandlerInstalled;

    /** Keep the stack trace of a crash so the app can offer to share it on the next start. */
    private void installCrashHandler() {
        if (crashHandlerInstalled) return;
        crashHandlerInstalled = true;
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        final java.io.File file = new java.io.File(getFilesDir(), "crash.txt");
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override
            public void uncaughtException(Thread t, Throwable e) {
                try (java.io.PrintWriter w = new java.io.PrintWriter(new java.io.FileWriter(file))) {
                    w.println("Notebound " + versionName() + " on Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + "), " + Build.MANUFACTURER + " " + Build.MODEL);
                    w.println(new java.util.Date());
                    e.printStackTrace(w);
                } catch (Exception ignored) {
                    // nothing else we can do
                }
                if (previous != null) previous.uncaughtException(t, e);
            }
        });
    }

    /** Text follows Android's font size setting (Settings > Display > Font size). */
    private static int textZoom(Configuration c) {
        return Math.round((c.fontScale > 0 ? c.fontScale : 1f) * 100);
    }

    String takeCrashReport() {
        java.io.File file = new java.io.File(getFilesDir(), "crash.txt");
        if (!file.exists()) return null;
        try (java.io.InputStream in = new java.io.FileInputStream(file)) {
            return new String(SafStore.readAll(in), java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        } finally {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        installCrashHandler();
        setupWindow();
        int webViewVersion = Compat.webViewMajor(this);
        if (webViewVersion > 0 && webViewVersion < Compat.MIN_WEBVIEW) {
            showOldWebView(webViewVersion);
            return;
        }
        root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        final boolean debug = (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debug);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setTextZoom(textZoom(getResources().getConfiguration()));
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setBackgroundColor(isNight() ? 0xFF11141A : 0xFFF4F5F8);

        bridge = new Bridge(this, web);
        content = new LocalContent(this, bridge.store);
        web.addJavascriptInterface(bridge, "NoteboundNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return content.handle(request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return overrideUrl(request.getUrl());
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // Android 5 and 6 only call this older version.
                return overrideUrl(Uri.parse(url));
            }

            private boolean overrideUrl(Uri u) {
                if (LocalContent.isLocal(u)) {
                    // Only the app page itself may load in this WebView.
                    return !"/app/index.html".equals(u.getPath());
                }
                // Links in notes open in the user's browser, never inside the app.
                String scheme = u.getScheme() == null ? "" : u.getScheme();
                if (scheme.equals("http") || scheme.equals("https") || scheme.equals("mailto") || scheme.equals("tel")) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, u));
                    } catch (Exception e) {
                        Log.w(TAG, "no app opens this kind of link");
                    }
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                bridge.pageReady = false;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                // Messages can name notes, so release builds keep them out of the system log.
                if (debug) Log.d(TAG, "js: " + m.message() + " @" + m.lineNumber());
                return true;
            }
        });

        installInsets();
        handleIntent(getIntent(), false);
        refreshLockState();
        publishShortcuts();
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = new OnBackInvokedCallback() {
                @Override
                public void onBackInvoked() {
                    bridge.emit("back", null);
                }
            };
        }
        web.loadUrl(LocalContent.APP_URL);
    }

    /** The phone's WebView is too old to run the app: say so plainly and offer the update. */
    private void showOldWebView(int version) {
        float d = getResources().getDisplayMetrics().density;
        android.widget.LinearLayout box = new android.widget.LinearLayout(this);
        box.setOrientation(android.widget.LinearLayout.VERTICAL);
        box.setGravity(android.view.Gravity.CENTER);
        int pad = (int) (28 * d);
        box.setPadding(pad, pad, pad, pad);
        box.setBackgroundColor(isNight() ? 0xFF11141A : 0xFFF4F5F8);
        android.widget.TextView title = new android.widget.TextView(this);
        title.setText("Please update Android System WebView");
        title.setTextSize(22);
        title.setTextColor(isNight() ? 0xFFE6E9F0 : 0xFF1C2233);
        title.setGravity(android.view.Gravity.CENTER);
        android.widget.TextView body = new android.widget.TextView(this);
        body.setText("Notebound shows your notes with the phone's built-in web component (Android System WebView). "
            + "This phone has version " + version + ", but Notebound needs version " + Compat.MIN_WEBVIEW
            + " or newer. Update \"Android System WebView\" (or Chrome) in your app store, then open Notebound again. "
            + "Your notes are not affected.");
        body.setTextSize(16);
        body.setTextColor(isNight() ? 0xFFA1A8B8 : 0xFF5D6578);
        body.setGravity(android.view.Gravity.CENTER);
        body.setPadding(0, (int) (14 * d), 0, (int) (20 * d));
        android.widget.Button open = new android.widget.Button(this);
        open.setText("Open app store");
        open.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.google.android.webview")));
                } catch (Exception e) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.google.android.webview")));
                    } catch (Exception ignored) {
                        // no store and no browser
                    }
                }
            }
        });
        box.addView(title);
        box.addView(body);
        box.addView(open);
        box.setFitsSystemWindows(true);
        setContentView(box);
    }

    // ------------------------------------------------------------ window & insets
    private void setupWindow() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
        } else {
            w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        if (Build.VERSION.SDK_INT < 35) {
            // Before Android 6 the status bar icons are always white: keep a dark tint behind them.
            w.setStatusBarColor(Build.VERSION.SDK_INT >= 23 ? Color.TRANSPARENT : 0x66000000);
            // Before Android 8 the navigation bar icons cannot be dark, so keep that bar dark.
            w.setNavigationBarColor(Build.VERSION.SDK_INT >= 26 ? Color.TRANSPARENT : 0xFF000000);
        }
        if (Build.VERSION.SDK_INT >= 29) {
            w.setNavigationBarContrastEnforced(false);
            w.setStatusBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }
        w.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
    }

    private void installInsets() {
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                float d = getResources().getDisplayMetrics().density;
                int top, bottom, left, right, keyboard;
                if (Build.VERSION.SDK_INT >= 30) {
                    android.graphics.Insets sys = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                    android.graphics.Insets kb = insets.getInsets(WindowInsets.Type.ime());
                    top = sys.top;
                    bottom = sys.bottom;
                    left = sys.left;
                    right = sys.right;
                    keyboard = Math.max(0, kb.bottom);
                } else {
                    top = insets.getSystemWindowInsetTop();
                    left = insets.getSystemWindowInsetLeft();
                    right = insets.getSystemWindowInsetRight();
                    int b = insets.getSystemWindowInsetBottom();
                    int stable = insets.getStableInsetBottom();
                    // With adjustResize the bottom inset includes the keyboard.
                    if (b > stable + (int) (80 * d)) {
                        keyboard = b;
                        bottom = stable;
                    } else {
                        keyboard = 0;
                        bottom = b;
                    }
                }
                // Shrink the WebView above the keyboard so the page can scroll the caret into view.
                root.setPadding(0, 0, 0, keyboard);
                bars[0] = Math.round(top / d);
                bars[1] = Math.round(bottom / d);
                bars[2] = Math.round(left / d);
                bars[3] = Math.round(right / d);
                ime = Math.round(keyboard / d);
                bridge.emit("insets", insetsJson());
                // Handled here; the WebView must not adjust for the bars or keyboard a second time.
                return Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED : insets.consumeSystemWindowInsets();
            }
        });
        root.requestApplyInsets();
    }

    JSONObject insetsJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("top", bars[0]);
            o.put("bottom", bars[1]);
            o.put("left", bars[2]);
            o.put("right", bars[3]);
            o.put("ime", ime);
        } catch (JSONException e) {
            // cannot happen
        }
        return o;
    }

    boolean isNight() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    void setLightBars(boolean light, String color) {
        Window w = getWindow();
        try {
            if (color != null && color.startsWith("#")) {
                int c = Color.parseColor(color);
                w.getDecorView().setBackgroundColor(c);
                web.setBackgroundColor(c);
            }
        } catch (IllegalArgumentException e) {
            // ignore bad colors
        }
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(light ? mask : 0, mask);
            }
        } else {
            View dv = w.getDecorView();
            int flags = dv.getSystemUiVisibility();
            int light23 = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            int light26 = Build.VERSION.SDK_INT >= 26 ? View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : 0;
            flags = light ? (flags | light23 | light26) : (flags & ~light23 & ~light26);
            dv.setSystemUiVisibility(flags);
        }
    }

    String versionName() {
        try {
            PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
            return pi.versionName;
        } catch (Exception e) {
            return "";
        }
    }

    /** Recents preview / screenshots follow the privacy settings even before the UI has loaded. */
    void refreshLockState() {
        SharedPreferences p = getSharedPreferences("notebound", MODE_PRIVATE);
        final boolean secure = "1".equals(p.getString("p:secureScreen", null));
        final boolean lock = "1".equals(p.getString("p:appLock", null));
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (secure) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
                if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(!(secure || lock));
            }
        });
    }

    // ------------------------------------------------------------ back handling
    void setBackEnabled(boolean enabled) {
        backEnabled = enabled;
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
            OnBackInvokedDispatcher d = getOnBackInvokedDispatcher();
            d.unregisterOnBackInvokedCallback((OnBackInvokedCallback) backCallback);
            if (enabled) d.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, (OnBackInvokedCallback) backCallback);
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (bridge == null) {
            super.onBackPressed();
            return;
        }
        if (backEnabled && bridge.pageReady) {
            bridge.emit("back", null);
            return;
        }
        moveTaskToBack(true);
    }

    // ------------------------------------------------------------ intents
    private void handleIntent(Intent intent, boolean live) {
        if (intent == null) return;
        JSONObject o = new JSONObject();
        try {
            String action = intent.getAction();
            if (ACTION_NEW.equals(action)) {
                o.put("action", "new");
                o.put("kind", intent.getStringExtra(EXTRA_KIND) == null ? "text" : intent.getStringExtra(EXTRA_KIND));
            } else if (ACTION_OPEN.equals(action)) {
                o.put("action", "open");
                o.put("noteId", intent.getStringExtra(EXTRA_NOTE_ID));
            } else if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                o.put("action", "share");
                CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
                o.put("text", text == null ? "" : text.toString());
                String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
                o.put("subject", subject == null ? "" : subject);
                JSONArray uris = new JSONArray();
                List<Uri> list = new ArrayList<>();
                if (Intent.ACTION_SEND.equals(action)) {
                    Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                    if (u != null) list.add(u);
                } else {
                    ArrayList<Uri> many = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                    if (many != null) list.addAll(many);
                }
                for (Uri u : list) if (ShareProvider.acceptShared(u.getScheme(), u.getAuthority(), ShareProvider.authority(this))) uris.put(u.toString());
                o.put("uris", uris);
                if (text == null && uris.length() == 0) return;
            } else {
                return;
            }
        } catch (JSONException e) {
            return;
        }
        deliver(o, live);
    }

    private void deliver(JSONObject o, boolean live) {
        if (live && bridge.pageReady) bridge.emit("intent", o);
        else pendingIntent = o.toString();
    }

    /** A photo taken before Android closed the app: it opens as a new note, like a shared picture. */
    void deliverPhoto(Uri photo) {
        try {
            JSONObject o = new JSONObject().put("action", "share").put("text", "").put("subject", "")
                .put("uris", new JSONArray().put(photo.toString()));
            deliver(o, true);
        } catch (JSONException e) {
            // cannot happen
        }
    }

    String takePendingIntent() {
        String p = pendingIntent;
        pendingIntent = null;
        return p;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (bridge != null) handleIntent(intent, true);
    }

    private void publishShortcuts() {
        if (Build.VERSION.SDK_INT < 25) return;
        ShortcutManager sm = getSystemService(ShortcutManager.class);
        if (sm == null) return;
        try {
            List<ShortcutInfo> list = Arrays.asList(
                shortcut("new_note", R.string.shortcut_note, R.drawable.ic_sc_note, "text"),
                shortcut("new_list", R.string.shortcut_list, R.drawable.ic_sc_list, "list"),
                shortcut("new_drawing", R.string.shortcut_drawing, R.drawable.ic_sc_drawing, "drawing"),
                shortcut("new_photo", R.string.shortcut_photo, R.drawable.ic_sc_photo, "photo"));
            sm.setDynamicShortcuts(list);
        } catch (Exception e) {
            Log.w(TAG, "shortcuts", e);
        }
    }

    @android.annotation.TargetApi(25)
    private ShortcutInfo shortcut(String id, int label, int icon, String kind) {
        Intent i = new Intent(this, MainActivity.class).setAction(ACTION_NEW).putExtra(EXTRA_KIND, kind)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return new ShortcutInfo.Builder(this, id)
            .setShortLabel(getString(label))
            .setIcon(Icon.createWithResource(this, icon))
            .setIntent(i)
            .build();
    }

    // ------------------------------------------------------------ lifecycle
    @Override
    protected void onPause() {
        super.onPause();
        if (bridge == null) return;
        pausedAt = SystemClock.elapsedRealtime();
        bridge.emit("pause", null);
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (bridge == null) return;
        web.onResume();
        if (pausedAt > 0) {
            JSONObject o = new JSONObject();
            try {
                o.put("pausedMs", SystemClock.elapsedRealtime() - pausedAt);
                o.put("forResult", bridge.takeLaunchedForResult());
            } catch (JSONException e) {
                // ignore
            }
            bridge.emit("resume", o);
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (bridge == null) return;
        web.getSettings().setTextZoom(textZoom(newConfig));
        JSONObject o = new JSONObject();
        try {
            o.put("dark", isNight());
        } catch (JSONException e) {
            // ignore
        }
        bridge.emit("night", o);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (bridge != null) bridge.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (bridge != null) bridge.onPermissionResult(requestCode, grantResults);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.removeJavascriptInterface("NoteboundNative");
            web.destroy();
        }
        super.onDestroy();
    }
}
