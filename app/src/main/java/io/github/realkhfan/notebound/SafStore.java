package io.github.realkhfan.notebound;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.webkit.MimeTypeMap;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * File access to the folder the user picked, through the Storage Access
 * Framework. Paths are relative to that folder and use "/" (e.g.
 * "notes/Shopping_ab12cd34.html"). Writes go to a temporary file first and are
 * then renamed, so a note file is never left half-written.
 */
final class SafStore {
    static final class Child {
        String docId;
        String name;
        boolean dir;
        long size;
        long mtime;
        String mime;
    }

    private static final String[] COLUMNS = {
        Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE,
        Document.COLUMN_SIZE, Document.COLUMN_LAST_MODIFIED,
    };

    private final ContentResolver cr;
    private Uri tree;
    private String rootId;
    private final Map<String, String> dirIds = new HashMap<>();
    private final Map<String, Map<String, Child>> listings = new HashMap<>();

    SafStore(Context ctx) {
        this.cr = ctx.getContentResolver();
    }

    boolean isOpen() {
        return tree != null && rootId != null;
    }

    Uri treeUri() {
        return tree;
    }

    /** Open the picked tree; {@code base} is an optional sub folder inside it (created if missing). */
    synchronized void open(Uri treeUri, String base) throws IOException {
        tree = treeUri;
        dirIds.clear();
        listings.clear();
        rootId = DocumentsContract.getTreeDocumentId(treeUri);
        // make sure the folder is still there and we may read it
        if (query(DocumentsContract.buildDocumentUriUsingTree(tree, rootId)) == null) {
            tree = null;
            rootId = null;
            throw new FileNotFoundException("The folder is no longer available");
        }
        if (base != null && !base.isEmpty()) {
            String id = resolveDir(base, true);
            if (id == null) throw new IOException("Could not create folder " + base);
            rootId = id;
            dirIds.clear();
        }
        dirIds.put("", rootId);
    }

    synchronized void close() {
        tree = null;
        rootId = null;
        dirIds.clear();
        listings.clear();
    }

    String rootName() {
        Child c = query(docUri(rootId));
        return c != null ? c.name : "";
    }

    Uri docUri(String docId) {
        return DocumentsContract.buildDocumentUriUsingTree(tree, docId);
    }

    private Child read(Cursor c) {
        Child ch = new Child();
        ch.docId = c.getString(0);
        ch.name = c.getString(1);
        ch.mime = c.getString(2);
        ch.dir = Document.MIME_TYPE_DIR.equals(ch.mime);
        ch.size = c.isNull(3) ? 0 : c.getLong(3);
        ch.mtime = c.isNull(4) ? 0 : c.getLong(4);
        return ch;
    }

    private Child query(Uri uri) {
        try (Cursor c = cr.query(uri, COLUMNS, null, null, null)) {
            if (c != null && c.moveToFirst()) return read(c);
        } catch (Exception e) {
            // missing or no permission
        }
        return null;
    }

    private Map<String, Child> listing(String dirId, boolean fresh) {
        Map<String, Child> m = fresh ? null : listings.get(dirId);
        if (m != null) return m;
        m = new HashMap<>();
        Uri uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, dirId);
        try (Cursor c = cr.query(uri, COLUMNS, null, null, null)) {
            if (c != null) {
                while (c.moveToNext()) {
                    Child ch = read(c);
                    if (ch.name != null) m.put(ch.name, ch);
                }
            }
        } catch (Exception e) {
            // unreadable directory: treat as empty
        }
        listings.put(dirId, m);
        return m;
    }

    private static String[] split(String path) {
        String p = path == null ? "" : path.replace('\\', '/');
        while (p.startsWith("/")) p = p.substring(1);
        while (p.endsWith("/")) p = p.substring(0, p.length() - 1);
        if (p.isEmpty()) return new String[0];
        String[] parts = p.split("/+");
        for (String s : parts) {
            if (s.equals("..") || s.equals(".")) throw new IllegalArgumentException("Invalid path: " + path);
        }
        return parts;
    }

    private static String join(String[] parts, int n) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            if (i > 0) sb.append('/');
            sb.append(parts[i]);
        }
        return sb.toString();
    }

    /** Document id of a directory, optionally creating missing parts. */
    synchronized String resolveDir(String path, boolean create) {
        String[] parts = split(path);
        String key = join(parts, parts.length);
        String known = dirIds.get(key);
        if (known != null) return known;
        String cur = rootId;
        for (int i = 0; i < parts.length; i++) {
            String sub = join(parts, i + 1);
            String cached = dirIds.get(sub);
            if (cached != null) { cur = cached; continue; }
            Child ch = listing(cur, false).get(parts[i]);
            if (ch == null) ch = listing(cur, true).get(parts[i]);
            if (ch == null || !ch.dir) {
                if (!create || ch != null) return null;
                try {
                    Uri u = DocumentsContract.createDocument(cr, docUri(cur), Document.MIME_TYPE_DIR, parts[i]);
                    if (u == null) return null;
                    listings.remove(cur);
                    ch = listing(cur, true).get(parts[i]);
                    if (ch == null) {
                        ch = new Child();
                        ch.docId = DocumentsContract.getDocumentId(u);
                        ch.dir = true;
                        ch.name = parts[i];
                    }
                } catch (Exception e) {
                    return null;
                }
            }
            cur = ch.docId;
            dirIds.put(sub, cur);
        }
        return cur;
    }

    private static String parentOf(String path) {
        String[] parts = split(path);
        return join(parts, Math.max(0, parts.length - 1));
    }

    private static String nameOf(String path) {
        String[] parts = split(path);
        if (parts.length == 0) throw new IllegalArgumentException("Empty path");
        return parts[parts.length - 1];
    }

    /** Find a file or folder; refreshes the parent listing once if it is not in the cache. */
    synchronized Child find(String path) {
        String[] parts = split(path);
        if (parts.length == 0) {
            Child c = new Child();
            c.docId = rootId;
            c.dir = true;
            c.name = "";
            return c;
        }
        String dirId = resolveDir(parentOf(path), false);
        if (dirId == null) return null;
        String name = parts[parts.length - 1];
        Child ch = listing(dirId, false).get(name);
        if (ch == null) ch = listing(dirId, true).get(name);
        return ch;
    }

    synchronized List<Child> list(String path) {
        String id = resolveDir(path, false);
        List<Child> out = new ArrayList<>();
        if (id == null) return out;
        out.addAll(listing(id, true).values());
        return out;
    }

    synchronized Child stat(String path) {
        Child ch = find(path);
        if (ch == null) return null;
        Child fresh = query(docUri(ch.docId));
        if (fresh == null) {
            invalidate(parentOf(path));
            ch = find(path);
            return ch == null ? null : query(docUri(ch.docId));
        }
        return fresh;
    }

    private void invalidate(String dirPath) {
        String id = resolveDir(dirPath, false);
        if (id != null) listings.remove(id);
    }

    InputStream openInput(String path) throws IOException {
        Child ch;
        synchronized (this) {
            ch = find(path);
        }
        if (ch == null || ch.dir) throw new FileNotFoundException(path);
        try {
            InputStream in = cr.openInputStream(docUri(ch.docId));
            if (in == null) throw new FileNotFoundException(path);
            return in;
        } catch (FileNotFoundException | SecurityException | IllegalArgumentException e) {
            // stale cache entry: the file was moved or deleted by another app
            synchronized (this) {
                invalidate(parentOf(path));
                ch = find(path);
            }
            if (ch == null || ch.dir) throw new FileNotFoundException(path);
            InputStream in = cr.openInputStream(docUri(ch.docId));
            if (in == null) throw new FileNotFoundException(path);
            return in;
        }
    }

    byte[] readBytes(String path) throws IOException {
        try (InputStream in = openInput(path)) {
            return readAll(in);
        }
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        return bos.toByteArray();
    }

    static String mimeFor(String name) {
        int dot = name.lastIndexOf('.');
        String ext = dot >= 0 ? name.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        return mime != null ? mime : "application/octet-stream";
    }

    synchronized Child writeBytes(String path, byte[] data) throws IOException {
        return writeStream(path, new ByteArrayInputStream(data));
    }

    /** Atomic-ish write: temp file, then replace the target. Returns the final file. */
    synchronized Child writeStream(String path, InputStream in) throws IOException {
        String name = nameOf(path);
        String dirPath = parentOf(path);
        String dirId = resolveDir(dirPath, true);
        if (dirId == null) throw new IOException("Could not create folder " + dirPath);
        Uri tmp;
        try {
            tmp = DocumentsContract.createDocument(cr, docUri(dirId), "application/octet-stream", name + ".pbtmp");
        } catch (Exception e) {
            tmp = null;
        }
        if (tmp == null) {
            // The provider refused the temp file: write the target directly.
            return writeDirect(dirId, path, name, in);
        }
        try {
            copyTo(tmp, in);
        } catch (IOException e) {
            deleteUri(tmp);
            throw e;
        }
        String tmpId = DocumentsContract.getDocumentId(tmp);
        // The cached listing is enough here; listing a big folder on every save would be slow.
        Child existing = listing(dirId, false).get(name);
        if (existing != null && !existing.docId.equals(tmpId)) deleteDoc(existing.docId);
        Uri renamed = renameTo(tmp, name);
        Child result = renamed != null ? query(renamed) : null;
        if (result != null && !name.equals(result.name)) {
            // Another app created a file with this name that the cache did not know about, so the
            // provider picked a different name for ours ("x (1).html"). Replace that file and retry.
            Child other = listing(dirId, true).get(name);
            if (other != null && !other.docId.equals(result.docId)) {
                deleteDoc(other.docId);
                Uri again = renameTo(docUri(result.docId), name);
                Child r2 = again != null ? query(again) : null;
                if (r2 != null) result = r2;
            }
        }
        if (result == null) {
            // Rename is not supported here: copy the temp file into place, then drop it.
            try (InputStream tin = cr.openInputStream(tmp)) {
                result = writeDirect(dirId, path, name, tin);
            }
            deleteUri(tmp);
        }
        if (result == null) throw new IOException("Could not save " + path);
        // keep the cached listing in step without another query
        Map<String, Child> cached = listings.get(dirId);
        if (cached != null) {
            java.util.Iterator<Map.Entry<String, Child>> it = cached.entrySet().iterator();
            while (it.hasNext()) {
                Child c = it.next().getValue();
                if (c.docId.equals(tmpId) || c.name.equals(name)) it.remove();
            }
            cached.put(result.name, result);
        }
        return result;
    }

    private Child writeDirect(String dirId, String path, String name, InputStream in) throws IOException {
        Child existing = listing(dirId, true).get(name);
        Uri target;
        if (existing != null) {
            target = docUri(existing.docId);
        } else {
            try {
                target = DocumentsContract.createDocument(cr, docUri(dirId), mimeFor(name), name);
            } catch (Exception e) {
                throw new IOException("Could not create " + path + ": " + e.getMessage());
            }
            if (target == null) throw new IOException("Could not create " + path);
        }
        copyTo(target, in);
        listings.remove(dirId);
        Child result = query(target);
        if (result == null) result = listing(dirId, true).get(name);
        return result;
    }

    /** Rename a document; returns its (possibly new) URI, or null when the provider cannot rename. */
    private Uri renameTo(Uri doc, String name) {
        try {
            Uri u = DocumentsContract.renameDocument(cr, doc, name);
            return u != null ? u : doc;
        } catch (Exception e) {
            return null;
        }
    }

    private void deleteUri(Uri uri) {
        try {
            DocumentsContract.deleteDocument(cr, uri);
        } catch (Exception e) {
            // already gone
        }
    }

    private void copyTo(Uri uri, InputStream in) throws IOException {
        OutputStream out;
        try {
            out = cr.openOutputStream(uri, "wt");
        } catch (IllegalArgumentException | UnsupportedOperationException e) {
            out = cr.openOutputStream(uri, "w");
        }
        if (out == null) throw new IOException("Cannot write file");
        try {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            out.flush();
        } finally {
            out.close();
        }
    }

    private void deleteDoc(String docId) {
        try {
            DocumentsContract.deleteDocument(cr, docUri(docId));
        } catch (Exception e) {
            // already gone
        }
    }

    synchronized void mkdirs(String path) throws IOException {
        if (resolveDir(path, true) == null) throw new IOException("Could not create folder " + path);
    }

    /** Delete a file or a whole folder. */
    synchronized boolean delete(String path) {
        Child ch = find(path);
        if (ch == null) return false;
        if (ch.dir) deleteTree(ch.docId);
        else deleteDoc(ch.docId);
        String parent = parentOf(path);
        invalidate(parent);
        // forget cached sub folders
        String[] pp = split(path);
        String prefix = join(pp, pp.length);
        List<String> drop = new ArrayList<>();
        for (String k : dirIds.keySet()) if (k.equals(prefix) || k.startsWith(prefix + "/")) drop.add(k);
        for (String k : drop) dirIds.remove(k);
        return true;
    }

    private void deleteTree(String dirId) {
        for (Child c : listing(dirId, true).values()) {
            if (c.dir) deleteTree(c.docId);
            else deleteDoc(c.docId);
        }
        listings.remove(dirId);
        deleteDoc(dirId);
    }

    synchronized String rename(String path, String newName) throws IOException {
        Child ch = find(path);
        if (ch == null) throw new FileNotFoundException(path);
        String parent = parentOf(path);
        String dirId = resolveDir(parent, false);
        if (listing(dirId, true).containsKey(newName)) throw new IOException("A file named " + newName + " already exists");
        try {
            DocumentsContract.renameDocument(cr, docUri(ch.docId), newName);
        } catch (Exception e) {
            throw new IOException("Could not rename: " + e.getMessage());
        }
        listings.remove(dirId);
        if (ch.dir) dirIds.clear();
        Child after = listing(dirId, true).get(newName);
        return after != null ? after.name : newName;
    }

    /** A name in {@code dir} that does not exist yet, keeping the extension. */
    synchronized String uniqueName(String dir, String wanted) {
        String id = resolveDir(dir, true);
        Map<String, Child> files = id == null ? new HashMap<String, Child>() : listing(id, true);
        if (!files.containsKey(wanted)) return wanted;
        int dot = wanted.lastIndexOf('.');
        String stem = dot > 0 ? wanted.substring(0, dot) : wanted;
        String ext = dot > 0 ? wanted.substring(dot) : "";
        for (int i = 2; i < 10000; i++) {
            String n = stem + "-" + i + ext;
            if (!files.containsKey(n)) return n;
        }
        return stem + "-" + System.currentTimeMillis() + ext;
    }
}
