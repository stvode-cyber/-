package com.aie.assistant;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * 极简 APK 安装插件
 *
 * 接收 APK 文件路径（app 内部存储），用 FileProvider 生成 content:// URI
 * 然后调 Intent.ACTION_VIEW + application/vnd.android.package-archive 触发系统安装器。
 *
 * 前置条件：
 * - AndroidManifest 声明 REQUEST_INSTALL_PACKAGES 权限
 * - AndroidManifest 配置 FileProvider，authorities = "${applicationId}.fileprovider"
 *
 * 前端调用：
 *   IntentInstaller.install({ path: '.../update.apk' })
 */
@CapacitorPlugin(name = "IntentInstaller")
public class IntentInstallerPlugin extends Plugin {

    private static final String FILEPROVIDER_AUTHORITY = "com.aie.assistant.fileprovider";

    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("缺少 path 参数");
            return;
        }

        File apkFile = new File(path);
        if (!apkFile.exists()) {
            call.reject("APK 文件不存在: " + path);
            return;
        }

        try {
            Context ctx = getContext();
            Uri apkUri;
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                // Android 7.0+：必须用 FileProvider，不能直接 file://
                apkUri = FileProvider.getUriForFile(ctx, FILEPROVIDER_AUTHORITY, apkFile);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } else {
                apkUri = Uri.fromFile(apkFile);
            }

            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            ctx.startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("启动安装器失败: " + e.getMessage());
        }
    }
}
