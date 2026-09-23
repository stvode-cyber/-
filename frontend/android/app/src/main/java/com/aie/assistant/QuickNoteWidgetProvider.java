package com.aie.assistant;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

/**
 * 随手记主屏小部件 Provider
 *
 * 行为：
 * - 桌面小部件显示一个"随手记"卡片（标题 + 副标题 + 提示文字）
 * - 用户点击小部件任意区域 → 发送 deep link Intent (aie://quick-note) 启动 MainActivity
 * - MainActivity 通过 Capacitor 的 @capacitor/app 插件触发 appUrlOpen 事件
 * - 前端监听到 appUrlOpen 事件后跳转 HomePage 并自动聚焦随手记输入框
 *
 * 设计说明：
 * - RemoteViews 不支持真正的 EditText（安全限制），所以小部件本身不能直接输入
 * - 点击小部件拉起应用，应用内 HomePage 的随手记输入框自动聚焦，实现"快速输入"体验
 * - 使用 PendingIntent.FLAG_IMMUTABLE（API 23+ 要求，Capacitor minSdk 通常为 23）
 */
public class QuickNoteWidgetProvider extends AppWidgetProvider {

    /** Deep link URI：aie://quick-note */
    private static final String DEEP_LINK_URI = "aie://quick-note";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int widgetId : appWidgetIds) {
            RemoteViews views = buildRemoteViews(context);
            appWidgetManager.updateAppWidget(widgetId, views);
        }
    }

    /**
     * 构建小部件 UI + 点击 Intent
     */
    private RemoteViews buildRemoteViews(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_quick_note);

        // 点击小部件任意区域 → 启动 MainActivity，带 deep link URI
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(DEEP_LINK_URI));
        intent.setClass(context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        // FLAG_IMMUTABLE 是 Android 12+ 强制要求，FLAG_UPDATE_CURRENT 确保每次更新都刷新 Intent
        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        views.setOnClickPendingIntent(R.id.widget_root, pendingIntent);

        return views;
    }
}
