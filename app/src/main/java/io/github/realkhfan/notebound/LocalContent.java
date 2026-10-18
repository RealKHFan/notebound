package io.github.realkhfan.notebound;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Serves the app UI and the user's folder to the WebView from a private
 * https origin (like androidx WebViewAssetLoader), so nothing is ever loaded
 * from the network:
 *   https://appassets.androidplatform.net/app/...   -> assets/web/...
 *   https://appassets.androidplatform.net/vault/... -> files in the chosen folder
 */
final class LocalContent {
    static final String HOST = "appassets.androidplatform.net";
    static final String ORIGIN = "https://" + HOST;
    static final String APP_URL = ORIGIN + "/app/index.html";

    private final Context ctx;
    private final SafStore store;

    LocalContent(Context ctx, SafStore store) {
        this.ctx = ctx;
        this.store = store;
    }

    static boolean isLocal(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && HOST.equals(uri.getHost());
    }

    static String mime(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".txt")) return "text/plain";
        return SafStore.mimeFor(path);
    }

    private static WebResourceResponse respond(int status, String reason, String mime, InputStream body) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        headers.put("X-Content-Type-Options", "nosniff");
        String enc = mime.startsWith("text/") || mime.endsWith("json") || mime.endsWith("javascript") || mime.endsWith("xml") ? "utf-8" : null;
        return new WebResourceResponse(mime, enc, status, reason, headers, body);
    }

    static WebResourceResponse notFound() {
        return respond(404, "Not Found", "text/plain", new ByteArrayInputStream(new byte[0]));
    }

    static WebResourceResponse blocked() {
        return respond(403, "Forbidden", "text/plain", new ByteArrayInputStream(new byte[0]));
    }

    WebResourceResponse handle(WebResourceRequest req) {
        Uri uri = req.getUrl();
        if (!isLocal(uri)) {
            // The app has no internet permission; refuse anything remote explicitly.
            String scheme = uri.getScheme();
            if ("data".equals(scheme) || "blob".equals(scheme)) return null;
            return blocked();
        }
        String path = uri.getPath();
        if (path == null) return notFound();
        try {
            if (path.startsWith("/app/")) {
                String rel = path.substring(5);
                if (rel.isEmpty()) rel = "index.html";
                if (rel.contains("..")) return notFound();
                InputStream in = ctx.getAssets().open("web/" + rel);
                return respond(200, "OK", mime(rel), in);
            }
            if (path.startsWith("/vault/")) {
                String rel = path.substring(7);
                if (!store.isOpen() || rel.contains("..")) return notFound();
                return respond(200, "OK", mime(rel), store.openInput(rel));
            }
        } catch (IOException | IllegalArgumentException e) {
            return notFound();
        }
        return notFound();
    }
}
