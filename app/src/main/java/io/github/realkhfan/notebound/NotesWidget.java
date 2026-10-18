package io.github.realkhfan.notebound;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.widget.RemoteViews;

/** Home screen list of pinned and recent notes. Data comes from the app (prefs "widgetData"). */
public final class NotesWidget extends AppWidgetProvider {
    static void refreshAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, NotesWidget.class));
        if (ids.length == 0) return;
        mgr.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) {
            RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_notes);
            Intent svc = new Intent(ctx, NotesWidgetService.class)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
            svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
            v.setRemoteAdapter(R.id.widget_list, svc);
            v.setEmptyView(R.id.widget_list, R.id.widget_empty);

            Intent open = new Intent(ctx, MainActivity.class).setAction(MainActivity.ACTION_OPEN)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            v.setPendingIntentTemplate(R.id.widget_list, PendingIntent.getActivity(ctx, 20, open, flags));

            Intent launch = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            v.setOnClickPendingIntent(R.id.widget_title, PendingIntent.getActivity(ctx, 21, launch, PendingIntent.FLAG_UPDATE_CURRENT | Compat.immutable()));
            v.setOnClickPendingIntent(R.id.widget_add, QuickWidget.newNote(ctx, "text", 22));
            mgr.updateAppWidget(id, v);
        }
        mgr.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
    }
}
