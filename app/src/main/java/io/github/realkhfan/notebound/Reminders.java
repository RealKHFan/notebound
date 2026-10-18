package io.github.realkhfan.notebound;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Iterator;

/**
 * Reminder alarms. The notes (in the user's folder) are the source of truth;
 * the app sends the current list here, which is kept in private storage so
 * alarms can be restored after a reboot without opening the app.
 */
final class Reminders {
    static final String CHANNEL = "reminders";
    static final String ACTION_FIRE = "io.github.realkhfan.notebound.action.REMINDER";
    static final String ACTION_SNOOZE = "io.github.realkhfan.notebound.action.SNOOZE";
    static final String ACTION_DONE = "io.github.realkhfan.notebound.action.DONE";
    static final long SNOOZE_MS = 60L * 60L * 1000L;
    private static final String PREFS = "reminders";
    private static final String KEY = "items";
    private static final String DONE_KEY = "done";
    static final String TEST_ID = "__test";

    private Reminders() {}

    static synchronized JSONObject load(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            return new JSONObject(p.getString(KEY, "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    static synchronized void save(Context ctx, JSONObject all) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, all.toString()).apply();
    }

    static long effectiveTime(JSONObject it) {
        long snooze = it.optLong("snooze", 0);
        return snooze > 0 ? snooze : it.optLong("at", 0);
    }

    /** Replace all scheduled reminders with {@code items}. Returns how many alarms are set. */
    static synchronized int sync(Context ctx, JSONArray items) throws JSONException {
        JSONObject old = load(ctx);
        JSONObject next = new JSONObject();
        long now = System.currentTimeMillis();
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.getJSONObject(i);
            String id = it.getString("id");
            JSONObject prev = old.optJSONObject(id);
            // keep an active snooze for the same reminder
            if (prev != null && prev.optLong("snooze", 0) > now && prev.optLong("base", -1) == it.optLong("base", -2)) {
                it.put("snooze", prev.optLong("snooze"));
            }
            if (it.optLong("at", 0) <= 0 && it.optLong("snooze", 0) <= now) continue;
            next.put(id, it);
        }
        Iterator<String> keys = old.keys();
        while (keys.hasNext()) {
            String id = keys.next();
            if (id.startsWith("__")) {
                // a test reminder from Settings is not a note; keep it until it fires
                next.put(id, old.getJSONObject(id));
                continue;
            }
            if (!next.has(id)) cancel(ctx, id);
        }
        int n = 0;
        Iterator<String> nk = next.keys();
        while (nk.hasNext()) {
            String id = nk.next();
            long when = effectiveTime(next.getJSONObject(id));
            if (when > now) {
                schedule(ctx, id, when);
                n++;
            }
        }
        save(ctx, next);
        return n;
    }

    static boolean canExact(Context ctx) {
        if (Build.VERSION.SDK_INT < 31) return true;
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        return am != null && am.canScheduleExactAlarms();
    }

    private static PendingIntent alarmIntent(Context ctx, String id) {
        Intent i = new Intent(ctx, ReminderReceiver.class)
            .setAction(ACTION_FIRE)
            .setData(Uri.parse("notebound://reminder/" + Uri.encode(id)))
            .putExtra("id", id);
        return PendingIntent.getBroadcast(ctx, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | Compat.immutable());
    }

    static void schedule(Context ctx, String id, long when) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Compat.setAlarm(am, when, alarmIntent(ctx, id), canExact(ctx));
    }

    static void cancel(Context ctx, String id) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(alarmIntent(ctx, id));
    }

    /** After a reboot, a time change or an app update. Missed reminders are shown right away. */
    static synchronized void rescheduleAll(Context ctx) {
        JSONObject all = load(ctx);
        long now = System.currentTimeMillis();
        Iterator<String> keys = all.keys();
        java.util.List<String> missed = new java.util.ArrayList<>();
        while (keys.hasNext()) {
            String id = keys.next();
            JSONObject it = all.optJSONObject(id);
            if (it == null) continue;
            long when = effectiveTime(it);
            if (when > now) schedule(ctx, id, when);
            else missed.add(id);
        }
        for (String id : missed) fire(ctx, id);
    }

    static synchronized void fire(Context ctx, String id) {
        JSONObject all = load(ctx);
        JSONObject it = all.optJSONObject(id);
        if (it == null) return;
        notify(ctx, id, it.optString("title", "Reminder"), it.optString("text", ""), effectiveTime(it));
        String repeat = it.optString("repeat", "none");
        long now = System.currentTimeMillis();
        try {
            if ("none".equals(repeat) || repeat.isEmpty()) {
                all.remove(id);
            } else {
                long next = Recurrence.next(it.optLong("base", it.optLong("at")), repeat, now);
                it.remove("snooze");
                if (next > 0) {
                    it.put("at", next);
                    schedule(ctx, id, next);
                } else {
                    all.remove(id);
                }
            }
        } catch (JSONException e) {
            all.remove(id);
        }
        save(ctx, all);
    }

    static synchronized void snooze(Context ctx, String id, String title, String text) {
        JSONObject all = load(ctx);
        JSONObject it = all.optJSONObject(id);
        long when = System.currentTimeMillis() + SNOOZE_MS;
        try {
            if (it == null) {
                it = new JSONObject();
                it.put("id", id);
                it.put("title", title);
                it.put("text", text);
                it.put("at", 0);
                it.put("base", 0);
                it.put("repeat", "none");
            }
            it.put("snooze", when);
            all.put(id, it);
        } catch (JSONException e) {
            return;
        }
        save(ctx, all);
        schedule(ctx, id, when);
        dismiss(ctx, id);
    }

    /** A reminder in a few seconds, to check notifications on this phone. */
    static synchronized void scheduleTest(Context ctx, long delayMs, String title, String text) throws JSONException {
        JSONObject all = load(ctx);
        long when = System.currentTimeMillis() + delayMs;
        JSONObject it = new JSONObject();
        it.put("id", TEST_ID);
        it.put("title", title);
        it.put("text", text);
        it.put("at", when);
        it.put("base", when);
        it.put("repeat", "none");
        all.put(TEST_ID, it);
        save(ctx, all);
        schedule(ctx, TEST_ID, when);
    }

    /** "Done" on a notification: the app removes that reminder from the note next time it runs. */
    static synchronized void markDone(Context ctx, String id) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            JSONArray done = new JSONArray(p.getString(DONE_KEY, "[]"));
            done.put(id);
            p.edit().putString(DONE_KEY, done.toString()).apply();
        } catch (JSONException e) {
            p.edit().putString(DONE_KEY, new JSONArray().put(id).toString()).apply();
        }
        dismiss(ctx, id);
    }

    static synchronized JSONArray takeDone(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONArray done;
        try {
            done = new JSONArray(p.getString(DONE_KEY, "[]"));
        } catch (JSONException e) {
            done = new JSONArray();
        }
        p.edit().remove(DONE_KEY).apply();
        return done;
    }

    static void dismiss(Context ctx, String id) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel("reminder", id.hashCode());
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, ctx.getString(R.string.channel_reminders), NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription(ctx.getString(R.string.channel_reminders_desc));
        ch.enableVibration(true);
        nm.createNotificationChannel(ch);
    }

    private static void notify(Context ctx, String id, String title, String text, long when) {
        ensureChannel(ctx);
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        Intent open = new Intent(ctx, MainActivity.class)
            .setAction(MainActivity.ACTION_OPEN)
            .putExtra(MainActivity.EXTRA_NOTE_ID, id)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(ctx, id.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | Compat.immutable());
        Intent sn = new Intent(ctx, ReminderReceiver.class).setAction(ACTION_SNOOZE)
            .setData(Uri.parse("notebound://snooze/" + Uri.encode(id)))
            .putExtra("id", id).putExtra("title", title).putExtra("text", text);
        Intent dn = new Intent(ctx, ReminderReceiver.class).setAction(ACTION_DONE)
            .setData(Uri.parse("notebound://done/" + Uri.encode(id)))
            .putExtra("id", id);
        PendingIntent snooze = PendingIntent.getBroadcast(ctx, 1, sn, PendingIntent.FLAG_UPDATE_CURRENT | Compat.immutable());
        PendingIntent done = PendingIntent.getBroadcast(ctx, 2, dn, PendingIntent.FLAG_UPDATE_CURRENT | Compat.immutable());
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, CHANNEL) : new Notification.Builder(ctx);
        b.setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title == null || title.isEmpty() ? ctx.getString(R.string.reminder) : title)
            .setContentText(text)
            .setStyle(new Notification.BigTextStyle().bigText(text))
            .setContentIntent(content)
            .setAutoCancel(true)
            .setWhen(when > 0 ? when : System.currentTimeMillis())
            .setShowWhen(true)
            .setCategory(Notification.CATEGORY_REMINDER)
            .setColor(0xFF2E4BD6);
        Compat.addAction(b, ctx.getString(R.string.snooze), snooze);
        Compat.addAction(b, ctx.getString(R.string.done), done);
        if (Build.VERSION.SDK_INT < 26) {
            b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        }
        try {
            nm.notify("reminder", id.hashCode(), b.build());
        } catch (SecurityException e) {
            // notifications not allowed
        }
    }
}
