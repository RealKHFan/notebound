package io.github.realkhfan.notebound;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/**
 * Hands single files from the app's cache to other apps: the camera writes a
 * new photo here, and shared or opened attachments are read from here.
 * Only files below cache/share and cache/capture are reachable.
 */
public final class ShareProvider extends ContentProvider {
    static String authority(Context ctx) {
        return ctx.getPackageName() + ".files";
    }

    /**
     * Whether a file another app shares with us may be read: only content:// from someone else's
     * provider. A file:// path or our own provider would make Notebound copy its private files.
     */
    static boolean acceptShared(String scheme, String authority, String ownAuthority) {
        return "content".equals(scheme) && authority != null && !authority.isEmpty() && !authority.equals(ownAuthority);
    }

    static Uri uriFor(Context ctx, File file) {
        File cache = ctx.getCacheDir();
        String rel = cache.toURI().relativize(file.toURI()).getPath();
        Uri.Builder b = new Uri.Builder().scheme("content").authority(authority(ctx));
        for (String seg : rel.split("/")) if (!seg.isEmpty()) b.appendPath(seg);
        return b.build();
    }

    private File fileFor(Uri uri) throws FileNotFoundException {
        Context ctx = getContext();
        if (ctx == null) throw new FileNotFoundException();
        File cache = ctx.getCacheDir();
        File f = cache;
        for (String seg : uri.getPathSegments()) f = new File(f, seg);
        try {
            String path = f.getCanonicalPath();
            String share = new File(cache, "share").getCanonicalPath() + File.separator;
            String capture = new File(cache, "capture").getCanonicalPath() + File.separator;
            if (!path.startsWith(share) && !path.startsWith(capture)) throw new FileNotFoundException("Not shared");
            return new File(path);
        } catch (IOException e) {
            throw new FileNotFoundException(e.getMessage());
        }
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File f;
        try {
            f = fileFor(uri);
        } catch (FileNotFoundException e) {
            return null;
        }
        String[] cols = projection != null ? projection : new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor c = new MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = f.getName();
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
        }
        c.addRow(row);
        return c;
    }

    @Override
    public String getType(Uri uri) {
        String last = uri.getLastPathSegment();
        return last == null ? "application/octet-stream" : SafStore.mimeFor(last);
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = fileFor(uri);
        int m = ParcelFileDescriptor.parseMode(mode);
        if ((m & ParcelFileDescriptor.MODE_WRITE_ONLY) != 0 || (m & ParcelFileDescriptor.MODE_READ_WRITE) != 0) {
            File parent = f.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) throw new FileNotFoundException("Cannot create folder");
        }
        return ParcelFileDescriptor.open(f, m);
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException();
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
