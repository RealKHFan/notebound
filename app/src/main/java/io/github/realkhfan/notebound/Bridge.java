package io.github.realkhfan.notebound;

import android.Manifest;
import android.app.Activity;
import android.app.KeyguardManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.hardware.biometrics.BiometricPrompt;
import android.net.Uri;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import android.view.HapticFeedbackConstants;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

/**
 * The object the web UI talks to (window.NoteboundNative). Every call is
 * asynchronous: call(id, method, json) answers later through
 * window.__nbNative.resolve(id, json) or reject(id, message).
 */
final class Bridge {
    private static final String TAG = "Notebound";
    static final int REQ_FOLDER = 101;
    static final int REQ_IMAGES = 102;
    static final int REQ_FILES = 103;
    static final int REQ_CAPTURE = 104;
    static final int REQ_IMPORT = 105;
    static final int REQ_SAVE = 106;
    static final int REQ_CONFIRM = 107;
    static final int REQ_NOTIF = 108;

    private final MainActivity activity;
    private final WebView web;
    final SafStore store;
    private final SharedPreferences prefs;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ExecutorService work = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    /** Calls waiting for an activity result: request code -> call id */
    private final Map<Integer, Integer> waiting = new HashMap<>();
    private final Map<Integer, Object> waitingData = new HashMap<>();
    // True while a picker, the camera or a permission dialog that we opened is in front.
    // Coming back from one of those is not "leaving the app" for the locks.
    private boolean launchedForResult;
    private final Map<String, File> importFiles = new HashMap<>();
    private File captureFile;
    private WebView printView;
    volatile boolean pageReady;

    Bridge(MainActivity activity, WebView web) {
        this.activity = activity;
        this.web = web;
        this.store = new SafStore(activity);
        this.prefs = activity.getSharedPreferences("notebound", Context.MODE_PRIVATE);
        reopenFolder();
    }

    void reopenFolder() {
        String uri = prefs.getString("folderUri", null);
        if (uri == null) return;
        try {
            store.open(Uri.parse(uri), prefs.getString("folderBase", ""));
        } catch (Exception e) {
            Log.w(TAG, "folder unavailable", e);
            store.close();
        }
    }

    // ------------------------------------------------------------ plumbing
    @JavascriptInterface
    public void call(final int id, final String method, final String argsJson) {
        final JSONObject args;
        try {
            args = argsJson == null || argsJson.isEmpty() ? new JSONObject() : new JSONObject(argsJson);
        } catch (JSONException e) {
            reject(id, "Bad arguments");
            return;
        }
        if (isUiMethod(method)) {
            main.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        dispatchUi(id, method, args);
                    } catch (Throwable t) {
                        Log.w(TAG, method, t);
                        reject(id, message(t));
                    }
                }
            });
            return;
        }
        io.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    Object result = dispatch(method, args);
                    resolve(id, result);
                } catch (Throwable t) {
                    Log.w(TAG, method, t);
                    reject(id, message(t));
                }
            }
        });
    }

    private static String message(Throwable t) {
        String m = t.getMessage();
        return m == null || m.isEmpty() ? t.getClass().getSimpleName() : m;
    }

    void resolve(final int id, Object result) {
        final String json = result == null ? "null" : (result instanceof String ? JSONObject.quote((String) result) : result.toString());
        main.post(new Runnable() {
            @Override
            public void run() {
                web.evaluateJavascript("window.__nbNative&&window.__nbNative.resolve(" + id + "," + JSONObject.quote(json) + ")", null);
            }
        });
    }

    void reject(final int id, final String msg) {
        main.post(new Runnable() {
            @Override
            public void run() {
                web.evaluateJavascript("window.__nbNative&&window.__nbNative.reject(" + id + "," + JSONObject.quote(msg) + ")", null);
            }
        });
    }

    void emit(final String name, final Object data) {
        final String json = data == null ? "" : data.toString();
        main.post(new Runnable() {
            @Override
            public void run() {
                if (!pageReady) return;
                web.evaluateJavascript("window.__nbNative&&window.__nbNative.emit(" + JSONObject.quote(name) + "," + JSONObject.quote(json) + ")", null);
            }
        });
    }

    private static boolean isUiMethod(String m) {
        switch (m) {
            case "pickFolder": case "pickImages": case "pickFiles": case "capturePhoto": case "pickImport":
            case "saveAs": case "saveZip": case "print": case "shareText": case "shareFile": case "openFile":
            case "openUrl": case "notificationPermission": case "openAlarmSettings": case "authenticate":
            case "setSecure": case "setSystemBars": case "haptic": case "setBackHandler": case "exit":
                return true;
            default:
                return false;
        }
    }

    private static JSONObject stat(SafStore.Child c) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("mtime", c.mtime);
        o.put("size", c.size);
        o.put("name", c.name);
        return o;
    }

    // ------------------------------------------------------------ background methods
    private Object dispatch(String method, JSONObject a) throws Exception {
        switch (method) {
            case "init": return init();
            case "useSubfolder": return useSubfolder(a.getString("name"));
            case "list": {
                requireFolder();
                JSONArray arr = new JSONArray();
                for (SafStore.Child c : store.list(a.optString("path", ""))) {
                    JSONObject o = new JSONObject();
                    o.put("name", c.name);
                    o.put("dir", c.dir);
                    o.put("size", c.size);
                    o.put("mtime", c.mtime);
                    arr.put(o);
                }
                return arr;
            }
            case "mkdirs":
                requireFolder();
                store.mkdirs(a.getString("path"));
                return Boolean.TRUE;
            case "read": {
                requireFolder();
                SafStore.Child c = store.find(a.getString("path"));
                if (c == null || c.dir) return null;
                try {
                    return new String(store.readBytes(a.getString("path")), StandardCharsets.UTF_8);
                } catch (IOException e) {
                    return null;
                }
            }
            case "readMany": {
                requireFolder();
                JSONArray paths = a.getJSONArray("paths");
                JSONObject out = new JSONObject();
                for (int i = 0; i < paths.length(); i++) {
                    String p = paths.getString(i);
                    try {
                        out.put(p, new String(store.readBytes(p), StandardCharsets.UTF_8));
                    } catch (IOException e) {
                        out.put(p, JSONObject.NULL);
                    }
                }
                return out;
            }
            case "write":
                requireFolder();
                return stat(store.writeBytes(a.getString("path"), a.getString("text").getBytes(StandardCharsets.UTF_8)));
            case "writeBase64":
                requireFolder();
                return stat(store.writeBytes(a.getString("path"), Base64.decode(a.getString("data"), Base64.DEFAULT)));
            case "readBase64": {
                requireFolder();
                try {
                    return Base64.encodeToString(store.readBytes(a.getString("path")), Base64.NO_WRAP);
                } catch (IOException e) {
                    return null;
                }
            }
            case "stat": {
                requireFolder();
                SafStore.Child c = store.stat(a.getString("path"));
                return c == null ? null : stat(c);
            }
            case "delete":
                requireFolder();
                return store.delete(a.getString("path"));
            case "rename": {
                requireFolder();
                JSONObject o = new JSONObject();
                o.put("name", store.rename(a.getString("path"), a.getString("name")));
                return o;
            }
            case "copy": {
                requireFolder();
                try (InputStream in = store.openInput(a.getString("src"))) {
                    return stat(store.writeStream(a.getString("dst"), in));
                }
            }
            case "prefsGet":
                return prefs.getString("p:" + a.getString("key"), null);
            case "prefsSet": {
                String key = "p:" + a.getString("key");
                if (a.isNull("value")) prefs.edit().remove(key).apply();
                else prefs.edit().putString(key, a.getString("value")).apply();
                if (key.equals("p:appLock") || key.equals("p:secureScreen")) activity.refreshLockState();
                return Boolean.TRUE;
            }
            case "cacheRead": {
                File f = privateFile(a.getString("name"));
                if (!f.exists()) return null;
                try (InputStream in = new FileInputStream(f)) {
                    return new String(SafStore.readAll(in), StandardCharsets.UTF_8);
                }
            }
            case "cacheWrite": {
                File f = privateFile(a.getString("name"));
                File tmp = new File(f.getPath() + ".tmp");
                try (OutputStream out = new FileOutputStream(tmp)) {
                    out.write(a.getString("text").getBytes(StandardCharsets.UTF_8));
                }
                if (!tmp.renameTo(f)) throw new IOException("Could not save cache");
                return Boolean.TRUE;
            }
            case "importShared": {
                requireFolder();
                JSONArray uris = a.getJSONArray("uris");
                List<Uri> list = new ArrayList<>();
                for (int i = 0; i < uris.length(); i++) list.add(Uri.parse(uris.getString(i)));
                return copyIntoAttachments(list);
            }
            case "importRead": {
                File f = importFiles.get(a.getString("id"));
                if (f == null) throw new IOException("Import file is gone");
                if (a.isNull("entry")) {
                    try (InputStream in = new FileInputStream(f)) {
                        return new String(SafStore.readAll(in), StandardCharsets.UTF_8);
                    }
                }
                try (ZipFile z = new ZipFile(f)) {
                    ZipEntry e = z.getEntry(a.getString("entry"));
                    if (e == null) return null;
                    try (InputStream in = z.getInputStream(e)) {
                        return new String(SafStore.readAll(in), StandardCharsets.UTF_8);
                    }
                }
            }
            case "importExtract": {
                requireFolder();
                File f = importFiles.get(a.getString("id"));
                if (f == null) throw new IOException("Import file is gone");
                String dest = a.getString("dest");
                if (!dest.startsWith("attachments/")) throw new IOException("Imports may only add attachments");
                if (a.isNull("entry")) {
                    try (InputStream in = new FileInputStream(f)) {
                        return stat(store.writeStream(dest, in));
                    }
                }
                try (ZipFile z = new ZipFile(f)) {
                    ZipEntry e = z.getEntry(a.getString("entry"));
                    if (e == null) return null;
                    try (InputStream in = z.getInputStream(e)) {
                        return stat(store.writeStream(dest, in));
                    }
                }
            }
            case "importDone":
                deleteTree(new File(activity.getCacheDir(), "import"));
                importFiles.clear();
                return Boolean.TRUE;
            case "syncReminders": {
                int n = Reminders.sync(activity, a.getJSONArray("items"));
                JSONObject o = new JSONObject();
                o.put("scheduled", n);
                o.put("exact", Reminders.canExact(activity));
                return o;
            }
            case "exactAlarmStatus":
                return Reminders.canExact(activity);
            case "testReminder":
                Reminders.scheduleTest(activity, Math.max(1000L, a.optLong("delayMs", 10000L)),
                    a.optString("title", "Test reminder"), a.optString("text", ""));
                return Boolean.TRUE;
            case "takeDoneReminders":
                return Reminders.takeDone(activity);
            case "authAvailable": {
                KeyguardManager km = (KeyguardManager) activity.getSystemService(Context.KEYGUARD_SERVICE);
                boolean ok = Compat.hasScreenLock(km);
                JSONObject o = new JSONObject();
                o.put("available", ok);
                o.put("reason", ok ? JSONObject.NULL : "Set a screen lock (PIN, pattern or password) in Android settings first.");
                return o;
            }
            case "widgetData":
                prefs.edit().putString("widgetData", a.getString("json")).apply();
                NotesWidget.refreshAll(activity);
                return Boolean.TRUE;
            default:
                throw new IllegalArgumentException("Unknown method " + method);
        }
    }

    private void requireFolder() throws IOException {
        if (!store.isOpen()) throw new IOException("No folder selected");
    }

    private File privateFile(String name) throws IOException {
        if (!name.matches("[A-Za-z0-9._-]{1,80}")) throw new IOException("Bad cache name");
        File dir = new File(activity.getFilesDir(), "cache");
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("Cannot create cache folder");
        return new File(dir, name);
    }

    private JSONObject init() throws JSONException {
        JSONObject o = new JSONObject();
        boolean has = store.isOpen();
        o.put("hasFolder", has);
        o.put("folderName", has ? folderLabel() : JSONObject.NULL);
        o.put("folderKey", has ? prefs.getString("folderUri", "") + "#" + prefs.getString("folderBase", "") : JSONObject.NULL);
        o.put("sdk", Build.VERSION.SDK_INT);
        o.put("appVersion", activity.versionName());
        o.put("night", activity.isNight());
        o.put("insets", activity.insetsJson());
        String pending = activity.takePendingIntent();
        o.put("intent", pending == null ? JSONObject.NULL : new JSONObject(pending));
        String crash = activity.takeCrashReport();
        o.put("lastCrash", crash == null ? JSONObject.NULL : crash);
        o.put("device", Build.MANUFACTURER + " " + Build.MODEL + ", Android " + Build.VERSION.RELEASE);
        pageReady = true;
        return o;
    }

    private String folderLabel() {
        String base = prefs.getString("folderBase", "");
        String name = store.rootName();
        if (name == null || name.isEmpty()) name = base;
        return name;
    }

    private JSONObject useSubfolder(String name) throws Exception {
        String clean = name.replaceAll("[\\\\/:*?\"<>|]", "").trim();
        if (clean.isEmpty()) throw new IOException("Bad folder name");
        String tree = prefs.getString("folderUri", null);
        if (tree == null) throw new IOException("No folder selected");
        store.open(Uri.parse(tree), clean);
        prefs.edit().putString("folderBase", clean).apply();
        JSONObject o = new JSONObject();
        o.put("name", clean);
        o.put("key", tree + "#" + clean);
        return o;
    }

    // ------------------------------------------------------------ attachments
    private String displayName(Uri uri) {
        try (Cursor c = activity.getContentResolver().query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (Exception e) {
            // ignore
        }
        String last = uri.getLastPathSegment();
        return last == null ? "file" : last;
    }

    private String safeName(String name, String mime) {
        String n = name == null ? "file" : name.replaceAll("[\\\\/:*?\"<>|#%{}^~\\[\\]`\\u0000-\\u001f]", "_").trim();
        if (n.length() > 60) {
            int dot = n.lastIndexOf('.');
            String ext = dot > 0 && n.length() - dot <= 8 ? n.substring(dot) : "";
            n = n.substring(0, 60 - ext.length()) + ext;
        }
        if (n.isEmpty()) n = "file";
        if (n.lastIndexOf('.') <= 0 && mime != null) {
            String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
            if (ext != null) n = n + "." + ext;
        }
        return n;
    }

    /** Copy picked/shared documents into attachments/ with unique names. */
    JSONArray copyIntoAttachments(List<Uri> uris) throws Exception {
        JSONArray out = new JSONArray();
        for (Uri uri : uris) {
            String mime = activity.getContentResolver().getType(uri);
            String name = safeName(displayName(uri), mime);
            String unique = store.uniqueName("attachments", name);
            try (InputStream in = activity.getContentResolver().openInputStream(uri)) {
                if (in == null) continue;
                SafStore.Child c = store.writeStream("attachments/" + unique, in);
                JSONObject o = new JSONObject();
                o.put("path", "attachments/" + c.name);
                o.put("name", name);
                o.put("mime", mime == null ? SafStore.mimeFor(name) : mime);
                o.put("size", c.size);
                out.put(o);
            }
        }
        return out;
    }

    private static List<Uri> urisFrom(Intent data) {
        List<Uri> list = new ArrayList<>();
        if (data == null) return list;
        ClipData clip = data.getClipData();
        if (clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri u = clip.getItemAt(i).getUri();
                if (u != null) list.add(u);
            }
        }
        if (list.isEmpty() && data.getData() != null) list.add(data.getData());
        return list;
    }

    private static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    /** Copy a vault file to cache/share so another app can read it through ShareProvider. */
    private File stageForSharing(String path, String name) throws IOException {
        File dir = new File(activity.getCacheDir(), "share");
        deleteTree(dir);
        if (!dir.mkdirs()) throw new IOException("Cannot prepare file");
        String n = safeName(name == null || name.isEmpty() ? path.substring(path.lastIndexOf('/') + 1) : name, null);
        File f = new File(dir, n);
        try (InputStream in = store.openInput(path); OutputStream out = new FileOutputStream(f)) {
            byte[] buf = new byte[64 * 1024];
            int k;
            while ((k = in.read(buf)) > 0) out.write(buf, 0, k);
        }
        return f;
    }

    /** Whether the last pause was for something this app opened and waited on; clears the flag. */
    boolean takeLaunchedForResult() {
        boolean b = launchedForResult;
        launchedForResult = false;
        return b;
    }

    // ------------------------------------------------------------ UI-thread methods
    private void startForResult(int id, int req, Intent intent) {
        if (waiting.containsKey(req)) {
            // a previous picker never returned (e.g. the user switched apps); give up on it
            reject(waiting.remove(req), "Cancelled");
        }
        waiting.put(req, id);
        launchedForResult = true;
        try {
            activity.startActivityForResult(intent, req);
        } catch (ActivityNotFoundException e) {
            launchedForResult = false;
            waiting.remove(req);
            reject(id, "No app on this phone can do that");
        }
    }

    private void dispatchUi(int id, String method, JSONObject a) throws Exception {
        switch (method) {
            case "pickFolder": {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
                if (Build.VERSION.SDK_INT >= 26) {
                    i.putExtra(DocumentsContract.EXTRA_INITIAL_URI,
                        DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:Documents"));
                }
                startForResult(id, REQ_FOLDER, i);
                break;
            }
            case "pickImages": {
                Intent i;
                boolean multiple = a.optBoolean("multiple", true);
                if (Build.VERSION.SDK_INT >= 33) {
                    i = new Intent(MediaStore.ACTION_PICK_IMAGES);
                    if (multiple) i.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, Math.min(30, MediaStore.getPickImagesMaxLimit()));
                } else {
                    i = new Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE);
                    i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple);
                }
                startForResult(id, REQ_IMAGES, i);
                break;
            }
            case "pickFiles": {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE);
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, a.optBoolean("multiple", true));
                startForResult(id, REQ_FILES, i);
                break;
            }
            case "capturePhoto": {
                File dir = new File(activity.getCacheDir(), "capture");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("Cannot prepare camera");
                captureFile = new File(dir, "photo-" + System.currentTimeMillis() + ".jpg");
                Uri out = ShareProvider.uriFor(activity, captureFile);
                Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                i.putExtra(MediaStore.EXTRA_OUTPUT, out);
                i.setClipData(ClipData.newRawUri("photo", out));
                i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startForResult(id, REQ_CAPTURE, i);
                break;
            }
            case "pickImport": {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE);
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                i.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
                    "application/zip", "application/x-zip-compressed", "application/json", "text/html", "text/markdown",
                    "text/x-markdown", "text/plain", "application/octet-stream",
                });
                startForResult(id, REQ_IMPORT, i);
                break;
            }
            case "saveAs": {
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(a.optString("mime", "application/octet-stream"))
                    .putExtra(Intent.EXTRA_TITLE, a.getString("name"));
                byte[] data = a.has("base64") && !a.isNull("base64")
                    ? Base64.decode(a.getString("base64"), Base64.DEFAULT)
                    : a.optString("text", "").getBytes(StandardCharsets.UTF_8);
                waitingData.put(REQ_SAVE, data);
                startForResult(id, REQ_SAVE, i);
                break;
            }
            case "saveZip": {
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("application/zip").putExtra(Intent.EXTRA_TITLE, a.getString("name"));
                waitingData.put(REQ_SAVE, a.getJSONArray("entries"));
                startForResult(id, REQ_SAVE, i);
                break;
            }
            case "print":
                print(id, a.optString("title", "Note"), a.getString("html"));
                break;
            case "shareText": {
                Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain")
                    .putExtra(Intent.EXTRA_TEXT, a.optString("text", ""));
                String subject = a.optString("subject", "");
                if (!subject.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, subject);
                activity.startActivity(Intent.createChooser(send, null));
                resolve(id, Boolean.TRUE);
                break;
            }
            case "shareFile":
            case "openFile": {
                final String path = a.getString("path");
                final String mimeArg = a.optString("mime", "");
                final String name = a.optString("name", "");
                final boolean open = "openFile".equals(method);
                work.execute(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            final File f = stageForSharing(path, name);
                            final Uri uri = ShareProvider.uriFor(activity, f);
                            final String mime = mimeArg.isEmpty() ? SafStore.mimeFor(f.getName()) : mimeArg;
                            main.post(new Runnable() {
                                @Override
                                public void run() {
                                    Intent i;
                                    if (open) {
                                        i = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime);
                                    } else {
                                        i = new Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri);
                                    }
                                    i.setClipData(ClipData.newRawUri(f.getName(), uri));
                                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                                    try {
                                        activity.startActivity(open ? i : Intent.createChooser(i, null));
                                        resolve(id, Boolean.TRUE);
                                    } catch (ActivityNotFoundException e) {
                                        reject(id, "No app on this phone can open this file");
                                    }
                                }
                            });
                        } catch (Exception e) {
                            reject(id, message(e));
                        }
                    }
                });
                break;
            }
            case "openUrl": {
                Uri u = Uri.parse(a.getString("url"));
                String s = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
                if (!s.equals("http") && !s.equals("https") && !s.equals("mailto") && !s.equals("tel")) {
                    reject(id, "Only web, mail and phone links can be opened");
                    return;
                }
                try {
                    activity.startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    resolve(id, Boolean.TRUE);
                } catch (ActivityNotFoundException e) {
                    reject(id, "No app on this phone can open this link");
                }
                break;
            }
            case "notificationPermission": {
                if (Build.VERSION.SDK_INT < 33) {
                    android.app.NotificationManager nm = (android.app.NotificationManager) activity.getSystemService(Context.NOTIFICATION_SERVICE);
                    resolve(id, Compat.notificationsEnabled(nm) ? "granted" : "denied");
                    return;
                }
                if (activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
                    resolve(id, "granted");
                    return;
                }
                if (!a.optBoolean("request", false)) {
                    resolve(id, "denied");
                    return;
                }
                waiting.put(REQ_NOTIF, id);
                launchedForResult = true;
                activity.requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
                break;
            }
            case "openAlarmSettings": {
                if (Build.VERSION.SDK_INT >= 31) {
                    try {
                        activity.startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + activity.getPackageName())));
                    } catch (ActivityNotFoundException e) {
                        // nothing to open
                    }
                }
                resolve(id, Boolean.TRUE);
                break;
            }
            case "authenticate":
                authenticate(id, a.optString("title", "Unlock Notebound"));
                break;
            case "setSecure": {
                boolean secure = a.optBoolean("secure", false);
                if (secure) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
                else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
                if (Build.VERSION.SDK_INT >= 33) activity.setRecentsScreenshotEnabled(!a.optBoolean("hideRecents", false));
                resolve(id, Boolean.TRUE);
                break;
            }
            case "setSystemBars":
                activity.setLightBars(a.optBoolean("lightBackground", true), a.optString("color", ""));
                resolve(id, Boolean.TRUE);
                break;
            case "haptic": {
                String kind = a.optString("kind", "tick");
                int c = "long".equals(kind) ? HapticFeedbackConstants.LONG_PRESS
                    : Build.VERSION.SDK_INT >= 30 && "confirm".equals(kind) ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.CLOCK_TICK;
                web.performHapticFeedback(c);
                resolve(id, Boolean.TRUE);
                break;
            }
            case "setBackHandler":
                activity.setBackEnabled(a.optBoolean("enabled", false));
                resolve(id, Boolean.TRUE);
                break;
            case "exit":
                activity.moveTaskToBack(true);
                resolve(id, Boolean.TRUE);
                break;
            default:
                throw new IllegalArgumentException("Unknown method " + method);
        }
    }

    private void authenticate(final int id, String title) {
        KeyguardManager km = (KeyguardManager) activity.getSystemService(Context.KEYGUARD_SERVICE);
        if (!Compat.hasScreenLock(km)) {
            resolve(id, Boolean.FALSE);
            return;
        }
        if (Build.VERSION.SDK_INT >= 29) {
            BiometricPrompt.Builder b = new BiometricPrompt.Builder(activity).setTitle(title);
            if (Build.VERSION.SDK_INT >= 30) {
                b.setAllowedAuthenticators(android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_WEAK
                    | android.hardware.biometrics.BiometricManager.Authenticators.DEVICE_CREDENTIAL);
            } else {
                b.setDeviceCredentialAllowed(true);
            }
            final boolean[] done = {false};
            b.build().authenticate(new CancellationSignal(), activity.getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    if (done[0]) return;
                    done[0] = true;
                    resolve(id, Boolean.TRUE);
                }

                @Override
                public void onAuthenticationError(int errorCode, CharSequence errString) {
                    if (done[0]) return;
                    done[0] = true;
                    resolve(id, Boolean.FALSE);
                }
            });
            return;
        }
        Intent i = km.createConfirmDeviceCredentialIntent(title, null);
        if (i == null) {
            resolve(id, Boolean.TRUE);
            return;
        }
        startForResult(id, REQ_CONFIRM, i);
    }

    private void print(final int id, final String title, String html) {
        final PrintManager pm = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
        if (pm == null) {
            reject(id, "Printing is not available");
            return;
        }
        final WebView pv = new WebView(activity);
        printView = pv;
        final LocalContent content = new LocalContent(activity, store);
        pv.getSettings().setJavaScriptEnabled(false);
        pv.getSettings().setAllowFileAccess(false);
        pv.getSettings().setAllowContentAccess(false);
        pv.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return content.handle(request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (printView != pv) return;
                String job = (title == null || title.isEmpty() ? "Note" : title);
                pm.print(job, pv.createPrintDocumentAdapter(job), new PrintAttributes.Builder().build());
                resolve(id, Boolean.TRUE);
            }
        });
        pv.loadDataWithBaseURL(LocalContent.ORIGIN + "/vault/notes/", html, "text/html", "utf-8", null);
    }

    // ------------------------------------------------------------ results
    void onPermissionResult(int requestCode, int[] results) {
        Integer id = waiting.remove(requestCode);
        if (id == null) return;
        boolean ok = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        resolve(id, ok ? "granted" : "denied");
    }

    void onActivityResult(final int requestCode, final int resultCode, final Intent data) {
        final Integer id = waiting.remove(requestCode);
        final Object extra = waitingData.remove(requestCode);
        if (id == null) return;
        final boolean ok = resultCode == Activity.RESULT_OK;
        switch (requestCode) {
            case REQ_CONFIRM:
                resolve(id, ok);
                return;
            case REQ_FOLDER: {
                if (!ok || data == null || data.getData() == null) {
                    resolve(id, null);
                    return;
                }
                final Uri tree = data.getData();
                io.execute(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            int flags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
                            activity.getContentResolver().takePersistableUriPermission(tree, flags);
                            String old = prefs.getString("folderUri", null);
                            if (old != null && !old.equals(tree.toString())) {
                                try {
                                    activity.getContentResolver().releasePersistableUriPermission(Uri.parse(old), flags);
                                } catch (Exception e) {
                                    // was not persisted
                                }
                            }
                            store.open(tree, "");
                            prefs.edit().putString("folderUri", tree.toString()).putString("folderBase", "").apply();
                            JSONObject o = new JSONObject();
                            o.put("name", store.rootName());
                            o.put("key", tree.toString() + "#");
                            o.put("empty", store.list("").isEmpty());
                            resolve(id, o);
                        } catch (Exception e) {
                            reject(id, "Notebound cannot use this folder: " + message(e));
                        }
                    }
                });
                return;
            }
            case REQ_IMAGES:
            case REQ_FILES: {
                if (!ok) {
                    resolve(id, new JSONArray());
                    return;
                }
                final List<Uri> uris = urisFrom(data);
                io.execute(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            resolve(id, copyIntoAttachments(uris));
                        } catch (Exception e) {
                            reject(id, message(e));
                        }
                    }
                });
                return;
            }
            case REQ_CAPTURE: {
                final File f = captureFile;
                captureFile = null;
                if (!ok || f == null || !f.exists() || f.length() == 0) {
                    resolve(id, null);
                    return;
                }
                io.execute(new Runnable() {
                    @Override
                    public void run() {
                        try (InputStream in = new FileInputStream(f)) {
                            String name = "photo-" + new java.text.SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(new java.util.Date()) + ".jpg";
                            String unique = store.uniqueName("attachments", name);
                            SafStore.Child c = store.writeStream("attachments/" + unique, in);
                            JSONObject o = new JSONObject();
                            o.put("path", "attachments/" + c.name);
                            o.put("name", c.name);
                            o.put("mime", "image/jpeg");
                            o.put("size", c.size);
                            resolve(id, o);
                        } catch (Exception e) {
                            reject(id, message(e));
                        } finally {
                            //noinspection ResultOfMethodCallIgnored
                            f.delete();
                        }
                    }
                });
                return;
            }
            case REQ_IMPORT: {
                if (!ok) {
                    resolve(id, null);
                    return;
                }
                final List<Uri> uris = urisFrom(data);
                work.execute(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            resolve(id, stageImports(uris));
                        } catch (Exception e) {
                            reject(id, message(e));
                        }
                    }
                });
                return;
            }
            case REQ_SAVE: {
                if (!ok || data == null || data.getData() == null) {
                    resolve(id, Boolean.FALSE);
                    return;
                }
                final Uri target = data.getData();
                work.execute(new Runnable() {
                    @Override
                    public void run() {
                        try (OutputStream out = activity.getContentResolver().openOutputStream(target, "wt")) {
                            if (out == null) throw new IOException("Cannot write the file");
                            if (extra instanceof byte[]) {
                                out.write((byte[]) extra);
                            } else if (extra instanceof JSONArray) {
                                writeZip(out, (JSONArray) extra);
                            }
                            resolve(id, Boolean.TRUE);
                        } catch (Exception e) {
                            reject(id, message(e));
                        }
                    }
                });
                return;
            }
            default:
                resolve(id, null);
        }
    }

    /** Tells the screen how far a long write has come (at most a few times a second). */
    private long lastProgress;
    private void progress(int done, int total) {
        long now = android.os.SystemClock.uptimeMillis();
        if (done < total && now - lastProgress < 150) return;
        lastProgress = now;
        try {
            emit("progress", new JSONObject().put("done", done).put("total", total));
        } catch (JSONException e) {
            // cannot happen
        }
    }

    private void writeZip(OutputStream raw, JSONArray entries) throws Exception {
        ZipOutputStream zip = new ZipOutputStream(raw);
        java.util.Set<String> seen = new java.util.HashSet<>();
        int total = entries.length();
        progress(0, total);
        for (int i = 0; i < entries.length(); i++) {
            progress(i, total);
            JSONObject e = entries.getJSONObject(i);
            String path = e.getString("path");
            if (!seen.add(path)) continue;
            if (e.has("text") && !e.isNull("text")) {
                zip.putNextEntry(new ZipEntry(path));
                zip.write(e.getString("text").getBytes(StandardCharsets.UTF_8));
                zip.closeEntry();
            } else if (e.has("vaultPath")) {
                try (InputStream in = store.openInput(e.getString("vaultPath"))) {
                    zip.putNextEntry(new ZipEntry(path));
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) zip.write(buf, 0, n);
                    zip.closeEntry();
                } catch (IOException missing) {
                    // skip files that disappeared
                }
            }
        }
        zip.finish();
        zip.flush();
        progress(total, total);
    }

    private JSONObject stageImports(List<Uri> uris) throws Exception {
        File dir = new File(activity.getCacheDir(), "import");
        deleteTree(dir);
        if (!dir.mkdirs()) throw new IOException("Cannot prepare import");
        importFiles.clear();
        JSONArray files = new JSONArray();
        int n = 0;
        for (Uri uri : uris) {
            String name = safeName(displayName(uri), null);
            File f = new File(dir, (n) + "-" + name);
            try (InputStream in = activity.getContentResolver().openInputStream(uri); OutputStream out = new FileOutputStream(f)) {
                if (in == null) continue;
                byte[] buf = new byte[64 * 1024];
                int k;
                while ((k = in.read(buf)) > 0) out.write(buf, 0, k);
            }
            String fid = "imp" + n++;
            importFiles.put(fid, f);
            JSONObject o = new JSONObject();
            o.put("id", fid);
            o.put("name", name);
            o.put("size", f.length());
            boolean zip = isZip(f);
            o.put("zip", zip);
            if (zip) {
                JSONArray entries = new JSONArray();
                try (ZipFile z = new ZipFile(f)) {
                    Enumeration<? extends ZipEntry> en = z.entries();
                    while (en.hasMoreElements()) {
                        ZipEntry ze = en.nextElement();
                        if (ze.isDirectory()) continue;
                        JSONObject eo = new JSONObject();
                        eo.put("name", ze.getName());
                        eo.put("size", ze.getSize());
                        entries.put(eo);
                    }
                }
                o.put("entries", entries);
            }
            files.put(o);
        }
        JSONObject result = new JSONObject();
        result.put("files", files);
        return result;
    }

    private static boolean isZip(File f) {
        try (InputStream in = new FileInputStream(f)) {
            byte[] head = new byte[4];
            return in.read(head) == 4 && head[0] == 'P' && head[1] == 'K' && head[2] == 3 && head[3] == 4;
        } catch (IOException e) {
            return false;
        }
    }

    static InputStream emptyStream() {
        return new ByteArrayInputStream(new byte[0]);
    }
}
