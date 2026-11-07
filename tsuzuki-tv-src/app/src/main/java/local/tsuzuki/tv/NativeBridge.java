package local.tsuzuki.tv;

// ============================================================
//  Мост между интерфейсом и Android — замена Electron-части с ПК.
//  В JavaScript доступен как window.AndroidBridge; обёртка
//  assets/www/android-api.js превращает его в привычный window.api.
//
//  Асинхронные методы получают id запроса и отвечают вызовом
//  window.__nativeResolve(id, успех, результат).
// ============================================================

import android.app.Activity;
import android.app.UiModeManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.database.Cursor;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.documentfile.provider.DocumentFile;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Collator;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.GZIPInputStream;

public class NativeBridge {

    // Shikimori просит указывать название приложения в User-Agent
    // ИЗМЕНЕНО В 1.3: версия в User-Agent, перенос старого файла данных AniDesk
    static final String USER_AGENT = "Tsuzuki/1.6.4 (anime tracker)"; // ИЗМЕНЕНО В 1.6.4
    static final String DATA_FILE = "tsuzuki-data.json";
    static final String OLD_DATA_FILE = "anidesk-data.json"; // файл старого названия (переносим один раз)
    static final List<String> VIDEO_EXT = Arrays.asList(".mp4", ".mkv", ".webm", ".m4v", ".mov", ".avi", ".ts");

    private static final int REQ_FOLDER = 101, REQ_OPEN_TEXT = 102, REQ_EXPORT = 103, REQ_IMPORT = 104;
    private static final int REQ_SAVE_IMAGE = 105; // ДОБАВЛЕНО В 1.5: картинка «Итогов года»

    private final Activity activity;
    private final WebView web;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private final Handler main = new Handler(Looper.getMainLooper());

    // запросы, ждущие ответа от системного окна выбора файла
    private final Map<Integer, String> pendingId = new HashMap<>();
    private String pendingExport = null;
    private byte[] pendingImage = null; // ДОБАВЛЕНО В 1.5

    NativeBridge(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
    }

    // ---------- Ответ в JavaScript ----------
    private void resolve(String id, boolean ok, String jsValue) {
        final String js = "window.__nativeResolve(" + JSONObject.quote(id) + "," + ok + "," + jsValue + ")";
        main.post(() -> web.evaluateJavascript(js, null));
    }
    private void ok(String id, String jsValue) { resolve(id, true, jsValue); }
    private void fail(String id, String message) { resolve(id, false, JSONObject.quote(String.valueOf(message))); }

    // ---------- Данные (твой список) ----------
    // ПЕРЕНОС ДАННЫХ (1.3): при первом запуске после переименования AniDesk → Tsuzuki
    // копируем старый файл данных в новый, чтобы список не потерялся.
    // Старый файл не удаляем — он остаётся как запасная копия.
    private File dataFile() {
        File f = new File(activity.getFilesDir(), DATA_FILE);
        if (!f.exists()) {
            File old = new File(activity.getFilesDir(), OLD_DATA_FILE);
            if (old.exists()) {
                try (InputStream in = new FileInputStream(old);
                     OutputStream out = new FileOutputStream(f)) {
                    byte[] chunk = new byte[16384];
                    int n;
                    while ((n = in.read(chunk)) > 0) out.write(chunk, 0, n);
                } catch (Exception ignored) { }
            }
        }
        return f;
    }

    @JavascriptInterface
    public String loadData() {
        try {
            File f = dataFile();
            if (!f.exists()) return "null";
            try (InputStream in = new FileInputStream(f)) {
                return new String(readAll(in), StandardCharsets.UTF_8);
            }
        } catch (Exception e) {
            return "null";
        }
    }

    @JavascriptInterface
    public void saveData(String json) {
        pool.execute(() -> {
            try {
                File f = dataFile();
                File tmp = new File(f.getPath() + ".tmp");
                try (OutputStream out = new FileOutputStream(tmp)) {
                    out.write(json.getBytes(StandardCharsets.UTF_8));
                }
                if (!tmp.renameTo(f)) {
                    f.delete();
                    tmp.renameTo(f);
                }
            } catch (Exception ignored) { }
        });
    }

    @JavascriptInterface
    public String dataPath() { return dataFile().getAbsolutePath(); }

    // ---------- Версия приложения и тип устройства (ИЗМЕНЕНО В 1.3) ----------
    @JavascriptInterface
    public String getVersionName() {
        try {
            return activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "1.3.0";
        }
    }

    @JavascriptInterface
    public int getVersionCode() {
        try {
            PackageInfo pi = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
            return (int) (Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode);
        } catch (Exception e) {
            return 0;
        }
    }

    @JavascriptInterface
    public String getDeviceType() {
        try {
            UiModeManager um = (UiModeManager) activity.getSystemService(Context.UI_MODE_SERVICE);
            return (um != null && um.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) ? "tv" : "phone";
        } catch (Exception e) {
            return "tv";
        }
    }

    // ---------- Токены аккаунта Shikimori (ИЗМЕНЕНО В 1.3) ----------
    // Хранятся в SharedPreferences приложения, отдельно от файла списка.
    // В общую резервную копию не попадают.
    private SharedPreferences authPrefs() {
        return activity.getSharedPreferences("tsuzuki-auth", Context.MODE_PRIVATE);
    }

    @JavascriptInterface
    public void saveAuth(String json) {
        authPrefs().edit().putString("auth", json).apply();
    }

    @JavascriptInterface
    public String loadAuth() {
        return authPrefs().getString("auth", "");
    }

    @JavascriptInterface
    public void clearAuth() {
        authPrefs().edit().remove("auth").apply();
    }

    // ---------- HTTP (Shikimori, AniList) ----------
    // Запросы идут отсюда, а не из страницы: так нет проблем с CORS
    // и можно поставить свой User-Agent.
    @JavascriptInterface
    public void request(String id, String method, String url, String headersJson, String body) {
        pool.execute(() -> {
            HttpURLConnection c = null;
            try {
                if (!url.startsWith("https://")) throw new IllegalArgumentException("Разрешены только https-запросы");
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setRequestMethod(method);
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                c.setRequestProperty("User-Agent", USER_AGENT);
                c.setRequestProperty("Accept", "application/json");
                JSONObject h = new JSONObject(headersJson == null || headersJson.isEmpty() ? "{}" : headersJson);
                for (Iterator<String> it = h.keys(); it.hasNext(); ) {
                    String k = it.next();
                    c.setRequestProperty(k, h.getString(k));
                }
                if (body != null && !body.isEmpty()) {
                    c.setDoOutput(true);
                    try (OutputStream out = c.getOutputStream()) {
                        out.write(body.getBytes(StandardCharsets.UTF_8));
                    }
                }
                int status = c.getResponseCode();
                InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                String text = in == null ? "" : new String(readAll(in), StandardCharsets.UTF_8);
                JSONObject res = new JSONObject();
                res.put("status", status);
                res.put("text", text);
                ok(id, res.toString());
            } catch (Exception e) {
                fail(id, "Нет соединения: " + e.getMessage());
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    // ---------- Папка с сериями ----------
    @JavascriptInterface
    public void pickFolder(String id) {
        main.post(() -> {
            try {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                pendingId.put(REQ_FOLDER, id);
                activity.startActivityForResult(i, REQ_FOLDER);
            } catch (ActivityNotFoundException e) {
                pendingId.remove(REQ_FOLDER);
                fail(id, "На этом устройстве нет системного окна выбора папки. Поставь файловый менеджер (например, X-plore) и попробуй снова.");
            }
        });
    }

    @JavascriptInterface
    public void listVideos(String id, String treeUri) {
        pool.execute(() -> {
            try {
                DocumentFile root = DocumentFile.fromTreeUri(activity, Uri.parse(treeUri));
                List<DocumentFile> found = new ArrayList<>();
                walk(root, 0, found);
                final Collator col = Collator.getInstance(new Locale("ru"));
                Collections.sort(found, (a, b) -> naturalCompare(col, a.getName(), b.getName()));
                JSONArray arr = new JSONArray();
                for (DocumentFile f : found) {
                    JSONObject o = new JSONObject();
                    o.put("name", f.getName());
                    o.put("path", f.getUri().toString());
                    o.put("url", f.getUri().toString());
                    arr.put(o);
                }
                ok(id, arr.toString());
            } catch (Exception e) {
                fail(id, "Не удалось прочитать папку: " + e.getMessage());
            }
        });
    }

    private void walk(DocumentFile dir, int depth, List<DocumentFile> out) {
        if (dir == null) return;
        for (DocumentFile f : dir.listFiles()) {
            if (f.isDirectory() && depth < 2) walk(f, depth + 1, out);
            else if (f.isFile() && f.getName() != null) {
                String n = f.getName().toLowerCase(Locale.ROOT);
                int dot = n.lastIndexOf('.');
                if (dot >= 0 && VIDEO_EXT.contains(n.substring(dot))) out.add(f);
            }
        }
    }

    // «2.mkv» раньше «10.mkv»
    private static int naturalCompare(Collator col, String a, String b) {
        String[] pa = String.valueOf(a).split("(?<=\\D)(?=\\d)|(?<=\\d)(?=\\D)");
        String[] pb = String.valueOf(b).split("(?<=\\D)(?=\\d)|(?<=\\d)(?=\\D)");
        for (int i = 0; i < Math.min(pa.length, pb.length); i++) {
            int r;
            if (pa[i].matches("\\d+") && pb[i].matches("\\d+")) {
                r = Long.compare(Long.parseLong(pa[i].length() > 18 ? pa[i].substring(0, 18) : pa[i]),
                        Long.parseLong(pb[i].length() > 18 ? pb[i].substring(0, 18) : pb[i]));
            } else r = col.compare(pa[i], pb[i]);
            if (r != 0) return r;
        }
        return Integer.compare(pa.length, pb.length);
    }

    // ---------- Открыть файл / ссылку другим приложением ----------
    @JavascriptInterface
    public void openPath(String uri) {
        main.post(() -> {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(Uri.parse(uri), "video/*");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                activity.startActivity(i);
            } catch (ActivityNotFoundException e) {
                toast("Нет видеоплеера. Установи VLC или MX Player из Google Play.");
            }
        });
    }

    @JavascriptInterface
    public void openExternal(String url) {
        main.post(() -> {
            try {
                if (!url.startsWith("https://") && !url.startsWith("http://")) return;
                activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (ActivityNotFoundException e) {
                toast("Нечем открыть ссылку: на телевизоре нет браузера или приложения сервиса.");
            }
        });
    }

    // ---------- Файлы: импорт и резервные копии ----------
    @JavascriptInterface
    public void openTextFile(String id) {
        startPicker(REQ_OPEN_TEXT, id, openDocIntent());
    }

    @JavascriptInterface
    public void importData(String id) {
        startPicker(REQ_IMPORT, id, openDocIntent());
    }

    @JavascriptInterface
    public void exportData(String id, String json, String fileName) {
        pendingExport = json;
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("application/json");
        i.putExtra(Intent.EXTRA_TITLE, fileName);
        startPicker(REQ_EXPORT, id, i);
    }

    private Intent openDocIntent() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        return i;
    }

    private void startPicker(int code, String id, Intent intent) {
        main.post(() -> {
            try {
                pendingId.put(code, id);
                activity.startActivityForResult(intent, code);
            } catch (ActivityNotFoundException e) {
                pendingId.remove(code);
                fail(id, "На этом устройстве нет системного окна выбора файлов.");
            }
        });
    }

    void onActivityResult(int code, int result, Intent data) {
        String id = pendingId.remove(code);
        if (id == null) return;
        Uri uri = (result == Activity.RESULT_OK && data != null) ? data.getData() : null;
        if (uri == null) { ok(id, "null"); return; } // пользователь отменил

        pool.execute(() -> {
            try {
                switch (code) {
                    case REQ_FOLDER: {
                        // запоминаем доступ к папке навсегда
                        activity.getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        ok(id, JSONObject.quote(uri.toString()));
                        break;
                    }
                    case REQ_OPEN_TEXT: {
                        JSONObject o = new JSONObject();
                        o.put("name", displayName(uri));
                        o.put("text", readText(uri));
                        ok(id, o.toString());
                        break;
                    }
                    case REQ_IMPORT: {
                        ok(id, JSONObject.quote(readText(uri)));
                        break;
                    }
                    case REQ_SAVE_IMAGE: { // ДОБАВЛЕНО В 1.5
                        try (OutputStream out = activity.getContentResolver().openOutputStream(uri)) {
                            out.write(pendingImage);
                        }
                        pendingImage = null;
                        ok(id, JSONObject.quote(displayName(uri)));
                        break;
                    }
                    case REQ_EXPORT: {
                        try (OutputStream out = activity.getContentResolver().openOutputStream(uri)) {
                            out.write(pendingExport.getBytes(StandardCharsets.UTF_8));
                        }
                        pendingExport = null;
                        ok(id, "true");
                        break;
                    }
                }
            } catch (Exception e) {
                fail(id, e.getMessage());
            }
        });
    }

    // Читает файл как текст; .gz (экспорт MyAnimeList) распаковывает сам
    private String readText(Uri uri) throws Exception {
        try (InputStream raw = new BufferedInputStream(activity.getContentResolver().openInputStream(uri))) {
            raw.mark(2);
            int b1 = raw.read(), b2 = raw.read();
            raw.reset();
            InputStream in = (b1 == 0x1f && b2 == 0x8b) ? new GZIPInputStream(raw) : raw;
            return new String(readAll(in), StandardCharsets.UTF_8);
        }
    }

    private String displayName(Uri uri) {
        try (Cursor c = activity.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) { }
        return "файл";
    }

    private static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[16384];
        int n;
        while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
        return buf.toByteArray();
    }

    // ============================================================
    //  ДОБАВЛЕНО В 1.5
    // ============================================================

    // ---------- Картинки постеров для «Итогов года» (data-URL) ----------
    @JavascriptInterface
    public void fetchImage(String id, String url) {
        pool.execute(() -> {
            HttpURLConnection c = null;
            try {
                URL u = new URL(url);
                String host = u.getHost();
                boolean allowed = "https".equals(u.getProtocol()) && (host.endsWith("shikimori.io") || host.endsWith("shikimori.one") || host.endsWith("shikimori.me"));
                if (!allowed) throw new IllegalArgumentException("Картинки загружаются только с Shikimori");
                c = (HttpURLConnection) u.openConnection();
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                c.setRequestProperty("User-Agent", USER_AGENT);
                if (c.getResponseCode() >= 400) throw new Exception("Картинка не загрузилась (" + c.getResponseCode() + ")");
                byte[] bytes = readAll(c.getInputStream());
                if (bytes.length > 6 * 1024 * 1024) throw new Exception("Слишком большая картинка");
                String type = c.getContentType() != null ? c.getContentType() : "image/jpeg";
                String b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);
                ok(id, JSONObject.quote("data:" + type + ";base64," + b64));
            } catch (Exception e) {
                fail(id, e.getMessage());
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    // ---------- Сохранить PNG через системное окно ----------
    @JavascriptInterface
    public void saveImage(String id, String base64, String fileName) {
        try {
            pendingImage = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
        } catch (Exception e) {
            fail(id, "Нет картинки для сохранения");
            return;
        }
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("image/png");
        i.putExtra(Intent.EXTRA_TITLE, fileName);
        startPicker(REQ_SAVE_IMAGE, id, i);
    }

    // ---------- Папка со всем аниме: подпапки с видео ----------
    @JavascriptInterface
    public void listSubfolders(String id, String treeUri) {
        pool.execute(() -> {
            try {
                DocumentFile root = DocumentFile.fromTreeUri(activity, Uri.parse(treeUri));
                JSONArray arr = new JSONArray();
                if (root != null) {
                    for (DocumentFile d : root.listFiles()) {
                        if (!d.isDirectory() || d.getName() == null || d.getName().startsWith(".")) continue;
                        List<DocumentFile> videos = new ArrayList<>();
                        walk(d, 0, videos);
                        if (videos.isEmpty()) continue;
                        JSONObject o = new JSONObject();
                        o.put("name", d.getName());
                        o.put("path", d.getUri().toString());
                        o.put("videos", videos.size());
                        arr.put(o);
                    }
                }
                ok(id, arr.toString());
            } catch (Exception e) {
                fail(id, "Не удалось прочитать папку: " + e.getMessage());
            }
        });
    }

    // ---------- Фоновые уведомления о новых сериях ----------
    @JavascriptInterface
    public void setBackgroundNotify(boolean enabled) {
        main.post(() -> {
            // Android 13+: без разрешения уведомления не показываются — спросим один раз
            SharedPreferences sp = activity.getSharedPreferences("tsuzuki", Context.MODE_PRIVATE);
            if (enabled && Build.VERSION.SDK_INT >= 33 && !sp.getBoolean("askedNotify", false)
                    && activity.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                sp.edit().putBoolean("askedNotify", true).apply(); // спрашиваем только один раз
                activity.requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 201);
            }
            EpisodesWorker.schedule(activity.getApplicationContext(), enabled);
        });
    }

    @JavascriptInterface
    public void checkEpisodesNow(String id) {
        pool.execute(() -> {
            try {
                List<EpisodesChecker.News> news = EpisodesChecker.check(activity.getApplicationContext(), true);
                JSONArray arr = new JSONArray();
                for (EpisodesChecker.News n : news) {
                    arr.put(new JSONObject().put("id", n.id).put("title", n.title).put("episode", n.episode));
                }
                ok(id, arr.toString());
            } catch (Exception e) {
                fail(id, "Не удалось проверить: " + e.getMessage());
            }
        });
    }

    // ---------- Обновление приложения: скачать APK и открыть установку ----------
    // ИЗМЕНЕНО В 1.6: принимаем sha256 из version.json и сверяем его с
    // контрольной суммой скачанного файла. Не совпало — файл удаляем,
    // установку не открываем (защита от подмены APK на сервере/в сети).
    @JavascriptInterface
    public void downloadAndInstall(String id, String url, String sha256) {
        pool.execute(() -> {
            HttpURLConnection c = null;
            try {
                if (!url.startsWith("https://")) throw new IllegalArgumentException("Обновления скачиваются только по https");
                // Android 8+: нужно разрешение «Установка неизвестных приложений» для Tsuzuki
                if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
                    main.post(() -> {
                        try {
                            activity.startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:" + activity.getPackageName())));
                        } catch (Exception ignored) { }
                    });
                    throw new Exception("Разреши Tsuzuki устанавливать приложения и нажми «Обновить» ещё раз");
                }
                File dir = new File(activity.getCacheDir(), "updates");
                dir.mkdirs();
                File apk = new File(dir, "tsuzuki-update.apk");
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(20000);
                c.setReadTimeout(60000);
                c.setRequestProperty("User-Agent", USER_AGENT);
                if (c.getResponseCode() >= 400) throw new Exception("Сервер ответил " + c.getResponseCode());
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                    byte[] chunk = new byte[65536];
                    int n;
                    while ((n = in.read(chunk)) > 0) out.write(chunk, 0, n);
                }
                // ИЗМЕНЕНО В 1.6: проверка SHA-256 до открытия установщика
                String expected = sha256 == null ? "" : sha256.trim().toLowerCase();
                if (!expected.isEmpty()) {
                    String actual = sha256Of(apk);
                    if (!expected.equals(actual)) {
                        //noinspection ResultOfMethodCallIgnored
                        apk.delete();
                        fail(id, "Скачанный файл не прошёл проверку SHA-256 — установка отменена");
                        return;
                    }
                }
                Uri uri = androidx.core.content.FileProvider.getUriForFile(activity, activity.getPackageName() + ".files", apk);
                main.post(() -> {
                    try {
                        Intent i = new Intent(Intent.ACTION_VIEW);
                        i.setDataAndType(uri, "application/vnd.android.package-archive");
                        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                        activity.startActivity(i);
                        ok(id, "true");
                    } catch (Exception e) {
                        fail(id, "Не удалось открыть установку: " + e.getMessage());
                    }
                });
            } catch (Exception e) {
                fail(id, e.getMessage());
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    // ИЗМЕНЕНО В 1.6: SHA-256 файла в hex (для проверки скачанного APK)
    private String sha256Of(File file) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        }
        StringBuilder sb = new StringBuilder();
        for (byte b : md.digest()) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private void toast(String text) {
        main.post(() -> Toast.makeText(activity, text, Toast.LENGTH_LONG).show());
    }
}
