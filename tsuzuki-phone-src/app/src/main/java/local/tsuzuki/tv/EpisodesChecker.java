package local.tsuzuki.tv;

// ============================================================
//  ДОБАВЛЕНО В 1.5: проверка новых серий без открытого приложения.
//  Читает твой список (tsuzuki-data.json), спрашивает у Shikimori,
//  сколько серий вышло у онгоингов из «Смотрю» и «В планах»,
//  и показывает уведомление «Вышла N серия».
//
//  Запускается из EpisodesWorker (раз в несколько часов, WorkManager)
//  и по кнопке «Проверить сейчас» (NativeBridge.checkEpisodesNow).
//  Что уже показывали, помним в SharedPreferences «episodes_seen».
// ============================================================

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

public class EpisodesChecker {

    static final String CHANNEL_ID = "episodes";
    static final String PREFS = "episodes_seen";
    static final String SHIKIMORI_GRAPHQL = "https://shikimori.io/api/graphql";

    // Результат проверки: что нового вышло
    static class News {
        int id; String title; int episode;
        News(int id, String title, int episode) { this.id = id; this.title = title; this.episode = episode; }
    }

    // notify = false — только посчитать (например, при первом включении)
    static List<News> check(Context ctx, boolean notify) throws Exception {
        List<News> out = new ArrayList<>();
        JSONObject data = readData(ctx);
        if (data == null) return out;
        JSONObject library = data.optJSONObject("library");
        if (library == null) return out;

        // Кого проверяем: статус «Смотрю»/«В планах», тайтл ещё выходит
        List<String> ids = new ArrayList<>();
        JSONObject titles = new JSONObject();
        for (Iterator<String> it = library.keys(); it.hasNext(); ) {
            String key = it.next();
            JSONObject e = library.optJSONObject(key);
            if (e == null) continue;
            String status = e.optString("status", "");
            String anime = e.optString("animeStatus", "");
            int id = e.optInt("id", 0);
            if (id <= 0) continue;
            if (!("watching".equals(status) || "planned".equals(status))) continue;
            if (!("ongoing".equals(anime) || "anons".equals(anime))) continue;
            ids.add(String.valueOf(id));
            titles.put(String.valueOf(id), e.optString("title", ""));
            if (ids.size() >= 50) break; // одним запросом, не больше 50
        }
        if (ids.isEmpty()) return out;

        String query = "{ animes(ids: \"" + android.text.TextUtils.join(",", ids) + "\", limit: 50) { id russian name episodesAired status } }";
        JSONObject body = new JSONObject().put("query", query);
        JSONObject res = new JSONObject(post(SHIKIMORI_GRAPHQL, body.toString()));
        JSONArray animes = res.optJSONObject("data") != null ? res.getJSONObject("data").optJSONArray("animes") : null;
        if (animes == null) return out;

        SharedPreferences seen = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor ed = seen.edit();
        for (int i = 0; i < animes.length(); i++) {
            JSONObject a = animes.getJSONObject(i);
            String id = a.optString("id");
            int aired = a.optInt("episodesAired", 0);
            int known = seen.getInt(id, -1);
            if (known >= 0 && aired > known) {
                String title = titles.optString(id, a.optString("russian", a.optString("name", "")));
                out.add(new News(Integer.parseInt(id), title, aired));
            }
            ed.putInt(id, aired);
        }
        ed.apply();

        if (notify) for (News n : out) show(ctx, n);
        return out;
    }

    // ---------- Уведомление ----------
    static void show(Context ctx, News n) {
        if (Build.VERSION.SDK_INT >= 33
                && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return; // разрешение не дали — молчим
        }
        ensureChannel(ctx);
        Intent open = new Intent(ctx, MainActivity.class)
                .putExtra(MainActivity.EXTRA_OPEN_ANIME, n.id)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getActivity(ctx, n.id, open, flags);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("Вышла " + n.episode + " серия")
                .setContentText(n.title)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        try {
            NotificationManagerCompat.from(ctx).notify(n.id, b.build());
        } catch (SecurityException ignored) { }
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Новые серии", NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription("Когда выходит новая серия онгоинга из «Смотрю» или «В планах»");
        nm.createNotificationChannel(ch);
    }

    // ---------- Файл данных и сеть ----------
    static JSONObject readData(Context ctx) {
        File f = new File(ctx.getFilesDir(), NativeBridge.DATA_FILE);
        if (!f.exists()) return null;
        try (InputStream in = new FileInputStream(f)) {
            return new JSONObject(new String(readAll(in), StandardCharsets.UTF_8));
        } catch (Exception e) {
            return null;
        }
    }

    static String post(String url, String json) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setRequestMethod("POST");
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", NativeBridge.USER_AGENT);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("Accept", "application/json");
            c.setDoOutput(true);
            try (OutputStream o = c.getOutputStream()) { o.write(json.getBytes(StandardCharsets.UTF_8)); }
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String text = in == null ? "" : new String(readAll(in), StandardCharsets.UTF_8);
            if (code >= 400) throw new Exception("Shikimori ответил " + code);
            return text;
        } finally {
            c.disconnect();
        }
    }

    static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[16384];
        int n;
        while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
        return buf.toByteArray();
    }
}
