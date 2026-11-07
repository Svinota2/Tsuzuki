package local.tsuzuki.tv;

// ============================================================
//  Главный экран: полноэкранный WebView, в котором работает тот же
//  интерфейс, что и на ПК (папка assets/www).
//  Файлы отдаются по адресу https://appassets.androidplatform.net/assets/www/,
//  чтобы работали ES-модули (с file:// Android их не пускает).
// ============================================================

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

public class MainActivity extends Activity {

    static final String HOST = "appassets.androidplatform.net";
    static final String START_URL = "https://" + HOST + "/assets/www/index.html";
    // ДОБАВЛЕНО В 1.5: id тайтла, который открыть (клик по уведомлению о новой серии)
    static final String EXTRA_OPEN_ANIME = "openAnime";

    private WebView web;
    private NativeBridge bridge;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        web.setBackgroundColor(0xFF0F1115);
        setContentView(web);
        hideSystemBars();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        // Страница верстается под ширину 1280 (см. <meta viewport> в index.html)
        // и масштабируется под экран ТВ
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setAllowFileAccess(false);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (HOST.equals(url.getHost())) return false; // свои страницы
                bridge.openExternal(url.toString());           // чужие — в браузер/приложение
                return true;
            }
        });
        // Нужен, чтобы работали confirm()/alert() (например, «Убрать тайтл из списка?»)
        web.setWebChromeClient(new WebChromeClient());

        bridge = new NativeBridge(this, web);
        web.addJavascriptInterface(bridge, "AndroidBridge");

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(openAnimeUrl(getIntent()));
    }

    // ДОБАВЛЕНО В 1.5: открыть страницу тайтла из уведомления
    private String openAnimeUrl(Intent intent) {
        int id = intent != null ? intent.getIntExtra(EXTRA_OPEN_ANIME, 0) : 0;
        return id > 0 ? START_URL + "#/anime/" + id : START_URL;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        int id = intent.getIntExtra(EXTRA_OPEN_ANIME, 0);
        if (id > 0) web.evaluateJavascript("location.hash = '#/anime/" + id + "'", null);
    }

    // Кнопка «Назад» на пульте: назад по разделам приложения, на первом экране — выход
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web.canGoBack()) {
            web.goBack();
            return true;
        }
        // Кнопка «Меню» на пульте = правый клик (например, «отметить все серии до этой»)
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            web.evaluateJavascript("window.__tvMenu && window.__tvMenu()", null);
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        bridge.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
}
