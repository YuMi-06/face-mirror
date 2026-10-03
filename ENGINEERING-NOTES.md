# 工程笔记

记录这个项目里**真踩过的坑**和**怎么验证的**。每一条都是先出问题、再定位、再修的过程。

## 一、file:// 下的三条硬限制（离线单文件版为什么长这样）

浏览器对 `file://` 页面有三条限制，单文件版逐条绕过去，实测结论：

| 限制 | 实测 | 绕法 |
| --- | --- | --- |
| `fetch` / `XMLHttpRequest` 读本地文件 | 被 CORS 拒（`origin 'null'`） | 模型改成内存里的 `Uint8Array`（`modelAssetBuffer`）；wasm 自己 base64 解码成字节交给 Emscripten 的 `Module.wasmBinary` |
| `<script type="module" src="本地文件">` | 被拒 | 全部源码用 `_tools/bundle.mjs` 打成**一个经典脚本**内联进 HTML |
| `<script src="本地文件" crossorigin="anonymous">` | 被拒（MediaPipe 加载 wasm 胶水层时写死了 `crossOrigin`） | 胶水层**内联成普通 `<script>`**，并把 `wasmLoaderPath` 置空让 MediaPipe 跳过脚本加载 |
| `getUserMedia` | **可用**（`file://` 是安全上下文） | 不需要绕 |

结果：单文件版**运行期不加载任何 URL**（应用内联、胶水层内联、wasm 与模型都在内存），
因此连"只允许内联脚本"的 CSP 都能跑。验证脚本：`_tools/probe_scripts.mjs`（插桩统计
运行期创建过的 `<script>`，实测为 **0**）。

## 二、踩过的坑

1. **`.bat` 必须 CRLF + 纯 ASCII。** 第一版是 LF 换行 + 中文 + `if ... ( ... )` 括号块，
   cmd.exe 解析失败，双击黑窗一闪、浏览器根本不打开。中文提示改由 `serve.mjs` 打印，
   脚本里不出现非 ASCII 字节。
2. **`#fatal` 的 CSS `display:flex` 盖掉了 `[hidden]` 的 UA 规则** → 覆盖层从第一帧就糊满全屏，
   而 DOM 状态一切正常。批量截图才发现（31 张全一样）。修法：`#fatal[hidden]{display:none!important}`。
3. **基线字典键名不一致**（`earA` vs `ear0`）→ `undefined` 参与运算产生 NaN，
   而 NaN 会被指数平滑器永久粘住，眼睛再也画不出来。平滑器现在对非有限值保持原值。
4. **`mood.sleepy` 只在下行分支更新** → 检出人脸后 `z z z` 一直挂着。
5. **官方测试肖像本身在大笑**（`mouthSmile≈0.96`、`jawOpen≈0.16`），不能拿它当中性脸基准；
   校准阈值前先用 `_tools/probe_metrics.mjs` 把真实数值量出来。
6. **脸被裁到画面边缘时**额头关键点（10 号）会被截断 → 用脸高归一化的所有比值集体失真，
   所以一律改用瞳距归一化。
7. **关键点 x/y 归一化尺度不同**，y 轴要乘 `aspect = 视频高/宽`，否则脸会被纵向拉伸 4/3。
8. **覆盖层不能在解析时读内联资源标志**（`window.__FM_STANDALONE` 由后面的脚本赋值），
   要在 `DOMContentLoaded` 里读，否则"请用 bat 打开"会盖在正常运行的页面上。
9. **文档尾部被截断**（复制不全 / 被杀软截断）→ 最后一段脚本不执行，表现为黑屏卡住。
   修法：应用脚本排到内联资源**前面**（截断时丢的是资源而不是程序），加 5 秒资源等待 + 明确报错。
10. **预览器用 blob:/data: 装载文档时 `document.baseURI` 不能当基址** → 顶层
    `new URL('vendor/…', document.baseURI)` 抛 `TypeError: Failed to construct 'URL'`，
    **整段程序不执行**。修法：所有相对地址走带 try/catch 的 `vendorUrl()`，加载期不依赖 baseURI。
11. **预览器的 CSP 拦掉 `data:` 脚本** → 胶水层加载失败，抛出来是 `[object Event]`
    （Event 不是 Error，没有 message）。修法见上表第三条。
12. **CSP 缺 `wasm-unsafe-eval` 时浏览器直接拒绝编译 WebAssembly** —— 这是环境硬限制，
    基于 wasm 的页面在那种窗口里永远起不来。修法只能是"提前探测 + 说人话"：
    `checkWasmAllowed()` 用最小 wasm 模块试编译，失败就明确提示换浏览器打开。
13. **错误提示自己把字吞了**：错误原文里含 ` on <script>`，直接塞 `innerHTML` 会被当成 HTML
    标签，把后面的文字全吃掉。所有动态文本都要先转义。

## 三、验证方式（不靠"没报错"下结论）

改动后跑这些（需要能起无头浏览器）：

```bash
node serve.mjs 8765 --no-open                     # 起本机服务
node _tools/bundle.mjs src/main.js --check        # 打包产物语法自检
node _tools/build_standalone.mjs                  # 重建单文件版

node _tools/capture.mjs <页面URL> <y4m> _verify/shots   # 真实链路 + 逐画风姿态截图（31 张）
node _tools/check_chooser.mjs <页面URL> <y4m> _verify/chooser  # 画风选择：自动弹出/点击生效/换人再弹
node _tools/check_boot.mjs <httpURL> <fileURL> _verify/boot     # 启动状态与覆盖层
node _tools/measure_load.mjs <URL>                # 载入耗时拆解（页内 performance.now 打点）
node _tools/probe_metrics.mjs <URL> _verify       # 量真实关键点数值（校准阈值用）
node _tools/probe_camera.mjs <URL> _verify/camera # 真摄像头能不能被浏览器打开
node _tools/probe_scripts.mjs                     # 插桩：运行期创建了几个 <script>
node _tools/check_badbase.mjs                     # 坏 baseURI 上下文（预览器场景）
node _tools/check_csp.mjs                         # 严格 CSP：允许/禁止 wasm 两种
node _tools/check_truncated.mjs                   # 文档被截断时的表现
```

实测通过的判据（举例）：

- 载入耗时：**17 MB 文件解析只花 150–250 ms**，真正开销是 MediaPipe 初始化 450–990 ms
  （wasm 编译 + 模型 + GPU 上下文），摄像头 0.1–2 s 与它并行。
- 单文件版：`ready=true`，运行期创建的 `<script>` 数 = **0**。
- 严格 CSP（补 `wasm-unsafe-eval`）→ 正常就绪；不补 → 明确提示"这个窗口跑不了这个页面"。
- 画风选择：人脸出现 → 自动弹出；四个格子的预览像素签名互不相同；真实鼠标点击生效；
  画面变黑 6.5 秒再恢复 → 当作"又来了一位"再次弹出。

## 四、性能

- wasm 二进制不再走 12 MB `data:` URL 的往返，改为 `Module.wasmBinary`：建任务 1000 → 450–900 ms。
- 摄像头与模型**并行**启动；设备枚举改为后台跑，不挡首屏。
- 全屏黑底载入页换成底部小胶囊：界面、背景、"睡着的五官"在开页 **0.15 秒内**就可见。
- 无头（软件渲染）下 10–15 fps 属正常；真机有 GPU 时 30–60 fps（真摄像头实测 36–39 fps）。
