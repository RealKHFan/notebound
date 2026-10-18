package io.github.realkhfan.notebound;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/** Home screen bar: "Take a note" plus new list, drawing and photo buttons. */
public final class QuickWidget extends AppWidgetProvider {
    static PendingIntent newNote(Context ctx, String kind, int code) {
        Intent i = new Intent(ctx, MainActivity.class)
            .setAction(MainActivity.ACTION_NEW)
            .putExtra(MainActivity.EXTRA_KIND, kind)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | Compat.immutable());
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) {
            RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_quick);
            v.setOnClickPendingIntent(R.id.quick_note, newNote(ctx, "text", 10));
            v.setOnClickPendingIntent(R.id.quick_list, newNote(ctx, "list", 11));
            v.setOnClickPendingIntent(R.id.quick_drawing, newNote(ctx, "drawing", 12));
            v.setOnClickPendingIntent(R.id.quick_photo, newNote(ctx, "photo", 13));
            mgr.updateAppWidget(id, v);
        }
    }
}
