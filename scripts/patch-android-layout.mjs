#!/usr/bin/env node
// Standard Android builds also run edge-to-edge. Fold reported system bars,
// cutouts and the keyboard into the native content container so the WebView
// cannot draw under a status bar, navigation bar or car head-unit dock.
// TV builds use patch-android-tv.mjs, which has its own equivalent policy.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const android = join(root, "src-tauri", "gen", "android");
if (!existsSync(android)) {
  console.log("[layout] Android 跳过：gen/android 还没生成（先跑 tauri android init）");
  process.exit(0);
}

const config = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const platformConfig = join(root, "src-tauri", "tauri.android.conf.json");
if (existsSync(platformConfig)) {
  const selected = JSON.parse(readFileSync(platformConfig, "utf8"));
  if (selected.identifier === "com.hghubx.tv") {
    console.log("[layout] TV 工程由 patch-android-tv.mjs 处理，标准布局补丁跳过");
    process.exit(0);
  }
}

const pkg = config.identifier;
if (!/^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)+$/.test(pkg)) {
  throw new Error(`[layout] 无法解析 Android applicationId: ${pkg}`);
}
const activityPath = join(android, "app", "src", "main", "java", ...pkg.split("."), "MainActivity.kt");
if (!existsSync(activityPath)) {
  throw new Error(`[layout] 缺少 ${activityPath}；请重新运行 tauri android init`);
}

const templates = [
`package ${pkg}
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}`,
`package ${pkg}
import android.os.Bundle
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
  }
}`,
];
const patched = `package ${pkg}
import android.content.res.Configuration
import android.os.Bundle
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // The activity owns system-bar/cutout/keyboard spacing. The WebView fills
    // the remaining content rect; CSS safe-area values are intentionally not
    // applied twice.
    WindowCompat.setDecorFitsSystemWindows(window, false)
    val content = findViewById<View>(android.R.id.content)
    content.fitsSystemWindows = false
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val safe = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or
          WindowInsetsCompat.Type.displayCutout() or
          WindowInsetsCompat.Type.ime()
      )
      // Some TV boxes and car head units draw fixed status/dock chrome without
      // reporting it as a system bar. Reserve a proportional fallback only for
      // those device classes; reported insets still win when they are larger.
      val configuration = resources.configuration
      val mode = configuration.uiMode and Configuration.UI_MODE_TYPE_MASK
      val largeLandscape = configuration.orientation == Configuration.ORIENTATION_LANDSCAPE &&
        configuration.screenWidthDp >= 960
      val reference = configuration.screenHeightDp.toFloat()
      val density = resources.displayMetrics.density
      val fallback = when (mode) {
        Configuration.UI_MODE_TYPE_CAR -> 0.04f to 0.14f
        Configuration.UI_MODE_TYPE_TELEVISION -> 0.025f to 0.05f
        else -> if (largeLandscape) (0.025f to 0.08f) else (0f to 0f)
      }
      val top = maxOf(safe.top, (reference * fallback.first * density).toInt())
      val bottom = maxOf(safe.bottom, (reference * fallback.second * density).toInt())
      view.setPadding(safe.left, top, safe.right, bottom)
      WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(content)
  }
}
`;
const normalize = (text) => text.trim().replace(/\s+/g, " ");
const current = readFileSync(activityPath, "utf8");
if (normalize(current) === normalize(patched)) {
  console.log(`[layout] 已写入 Android 安全视口：${pkg}`);
  process.exit(0);
}
if (!templates.some((template) => normalize(template) === normalize(current))) {
  throw new Error(`[layout] ${activityPath} 与已知 Tauri 模板不同，请审阅后再更新安全视口补丁`);
}
writeFileSync(activityPath, patched);
console.log(`[layout] 已写入 Android 安全视口：${pkg}`);
