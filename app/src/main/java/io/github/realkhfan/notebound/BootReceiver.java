package io.github.realkhfan.notebound;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Alarms do not survive a reboot or a clock change; put them back. */
public final class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        final PendingResult pending = goAsync();
        final Context app = ctx.getApplicationContext();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    Reminders.rescheduleAll(app);
                } finally {
                    pending.finish();
                }
            }
        }, "notebound-boot").start();
    }
}
