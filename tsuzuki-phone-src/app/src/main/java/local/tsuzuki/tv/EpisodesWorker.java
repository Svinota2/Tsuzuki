package local.tsuzuki.tv;

// ============================================================
//  ДОБАВЛЕНО В 1.5: фоновая задача «проверить новые серии».
//  Android сам запускает её раз в INTERVAL_HOURS часов, когда есть
//  интернет, даже если приложение закрыто (WorkManager).
//  Включение/выключение — NativeBridge.setBackgroundNotify.
// ============================================================

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.TimeUnit;

public class EpisodesWorker extends Worker {

    static final String WORK_NAME = "tsuzuki-episodes";
    static final long INTERVAL_HOURS = 6; // как часто проверять (Android может сдвинуть время)

    public EpisodesWorker(@NonNull Context ctx, @NonNull WorkerParameters params) {
        super(ctx, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        try {
            EpisodesChecker.check(getApplicationContext(), true);
            return Result.success();
        } catch (Exception e) {
            return Result.retry(); // нет сети / Shikimori недоступен — попробуем позже
        }
    }

    static void schedule(Context ctx, boolean enabled) {
        WorkManager wm = WorkManager.getInstance(ctx);
        if (!enabled) {
            wm.cancelUniqueWork(WORK_NAME);
            return;
        }
        Constraints c = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(EpisodesWorker.class, INTERVAL_HOURS, TimeUnit.HOURS)
                .setConstraints(c)
                .build();
        wm.enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, req);
    }
}
