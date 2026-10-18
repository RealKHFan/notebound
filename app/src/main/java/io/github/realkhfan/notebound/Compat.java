package io.github.realkhfan.notebound;

import android.app.AlarmManager;
import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.os.Build;
import android.webkit.WebSettings;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Small helpers that pick the right Android API for the phone's version, so
 * Notebound runs on everything from Android 5.0 (API 21) to the newest release.
 */
final class Compat {
    /** Oldest WebView (Chromium major version) whose JavaScript the bundled UI can run. */
    static final int MIN_WEBVIEW = 80;

    private Compat() {}

    /** FLAG_IMMUTABLE exists from Android 6; older versions treat every PendingIntent as fixed anyway. */
    static int immutable() {
        return Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
    }

    /** True when the phone has a PIN, pattern or password (needed for app lock). */
    static boolean hasScreenLock(KeyguardManager km) {
        if (km == null) return false;
        return Build.VERSION.SDK_INT >= 23 ? km.isDeviceSecure() : km.isKeyguardSecure();
    }

    static boolean notificationsEnabled(NotificationManager nm) {
        if (nm == null || Build.VERSION.SDK_INT < 24) return true;
        return nm.areNotificationsEnabled();
    }

    /** Exact alarm that also fires in Doze where the system allows it. */
    static void setAlarm(AlarmManager am, long when, PendingIntent pi, boolean exact) {
        if (Build.VERSION.SDK_INT >= 23) {
            try {
                if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
                else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
            } catch (SecurityException e) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
            }
        } else {
            // Android 5: no Doze yet, a plain exact alarm is reliable.
            am.setExact(AlarmManager.RTC_WAKEUP, when, pi);
        }
    }

    /** A text-only notification button. */
    @SuppressWarnings("deprecation")
    static void addAction(Notification.Builder b, CharSequence title, PendingIntent pi) {
        if (Build.VERSION.SDK_INT >= 23) {
            b.addAction(new Notification.Action.Builder((android.graphics.drawable.Icon) null, title, pi).build());
        } else {
            b.addAction(0, title, pi);
        }
    }

    /** Major version of the system WebView, or -1 when it cannot be told. */
    static int webViewMajor(Context ctx) {
        try {
            String ua = WebSettings.getDefaultUserAgent(ctx);
            Matcher m = Pattern.compile("Chrome/(\\d+)").matcher(ua == null ? "" : ua);
            if (m.find()) return Integer.parseInt(m.group(1));
        } catch (Throwable t) {
            // WebView missing or being updated: let the normal start-up report it
        }
        return -1;
    }
}
