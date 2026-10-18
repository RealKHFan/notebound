package io.github.realkhfan.notebound;

import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Supplies the rows of {@link NotesWidget}. */
public final class NotesWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext());
    }

    static final class Row {
        String id;
        String title;
        String text;
        int color;
        boolean pinned;
    }

    static final class Factory implements RemoteViewsFactory {
        private final Context ctx;
        private final List<Row> rows = new ArrayList<>();

        Factory(Context ctx) {
            this.ctx = ctx;
        }

        @Override
        public void onCreate() {}

        @Override
        public void onDataSetChanged() {
            rows.clear();
            boolean night = (ctx.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
            String json = ctx.getSharedPreferences("notebound", Context.MODE_PRIVATE).getString("widgetData", null);
            if (json == null) return;
            try {
                JSONArray notes = new JSONObject(json).getJSONArray("notes");
                for (int i = 0; i < notes.length(); i++) {
                    JSONObject n = notes.getJSONObject(i);
                    Row r = new Row();
                    r.id = n.getString("id");
                    r.title = n.optString("title", "");
                    r.text = n.optString("text", "");
                    String c = night ? n.optString("dark", "") : n.optString("light", "");
                    r.color = c.isEmpty() ? (night ? 0xFF191D25 : 0xFFFFFFFF) : Color.parseColor(c);
                    r.pinned = n.optBoolean("pinned", false);
                    rows.add(r);
                }
            } catch (Exception e) {
                rows.clear();
            }
        }

        @Override
        public void onDestroy() {
            rows.clear();
        }

        @Override
        public int getCount() {
            return rows.size();
        }

        @Override
        public RemoteViews getViewAt(int position) {
            Row r = rows.get(position);
            RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_note_item);
            v.setInt(R.id.item_bg, "setColorFilter", r.color);
            v.setTextViewText(R.id.item_title, r.title);
            v.setViewVisibility(R.id.item_title, r.title.isEmpty() ? android.view.View.GONE : android.view.View.VISIBLE);
            v.setTextViewText(R.id.item_text, r.text);
            v.setViewVisibility(R.id.item_text, r.text.isEmpty() ? android.view.View.GONE : android.view.View.VISIBLE);
            v.setViewVisibility(R.id.item_pin, r.pinned ? android.view.View.VISIBLE : android.view.View.GONE);
            Intent fill = new Intent().putExtra(MainActivity.EXTRA_NOTE_ID, r.id);
            v.setOnClickFillInIntent(R.id.item_root, fill);
            return v;
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return 1;
        }

        @Override
        public long getItemId(int position) {
            return rows.get(position).id.hashCode();
        }

        @Override
        public boolean hasStableIds() {
            return true;
        }
    }
}
