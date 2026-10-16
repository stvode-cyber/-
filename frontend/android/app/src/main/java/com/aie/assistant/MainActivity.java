package com.aie.assistant;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * 主 Activity：注册自定义 Capacitor 插件
 *
 * 用 initialPlugins.add() 在 super.onCreate() 之前注册，
 * 确保 IntentInstallerPlugin 在 Bridge 创建时就被加载。
 */
public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        this.initialPlugins.add(IntentInstallerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
