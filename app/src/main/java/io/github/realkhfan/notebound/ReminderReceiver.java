package io.github.realkhfan.notebound;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Alarm went off, or a notification button (Snooze / Done) was tapped. */
public final class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String id = intent.getStringExtra("id");
        String action = intent.getAction();
        if (id == null || action == null) return;
        switch (action) {
            case Reminders.ACTION_FIRE:
                Reminders.fire(ctx, id);
                break;
            case Reminders.ACTION_SNOOZE:
                Reminders.snooze(ctx, id, intent.getStringExtra("title"), intent.getStringExtra("text"));
                break;
            case Reminders.ACTION_DONE:
                Reminders.markDone(ctx, id);
                break;
            default:
                break;
        }
    }
}
