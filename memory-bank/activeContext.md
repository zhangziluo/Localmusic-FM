# 当前上下文（Active Context）

> 最后更新：2026-11-14

## 当前焦点

**新增「网页跳转」**：先按 `*` 进入跳转态，输入 `0`–`999999` 编号，再按 `*` 用 `window.open(url, '_blank', 'noopener,noreferrer')` 打开该编号绑定的网址。内置默认 `1`→streamurl.link、`2`→roamdial.com、`3`→globalradio.app，设置面板可增删改（`fm_webjumps`，最多 1000 条）。数码屏显示 `↗编号` 并闪烁，`*` 键呼吸提示。`*` 已从网络串流键位移除，旧 `*` 串流绑定会被 `loadStreams()` 丢弃。

**新增「播放记录导出」**：每次播放本地曲目都会写入 `fm_history`（最多 2000 条），设置面板底部可按「今天 / 昨天 / 近 7 天」或自定义起止时间，把该时段的曲目导出为 `fm-YYYYMMDD-HHMMSS.m3u`。

**新增「录制」**：音乐推子下方的 ⏺️ 按钮可录制当前本地曲目 / 网络串流。跨域串流先用 `fetch(..., { mode: 'cors' })` 探测，不允许 CORS 时按钮置灰并提示；录音使用独立 `Audio` 元素 + `MediaElementSource` + `MediaStreamDestination` + `MediaRecorder`，输出 `webm/opus`（Safari 可能为 `mp4/aac`）。

此前已完成：移除 RSS 播客、按序号点歌（`#` → 数字 → `#`）、串流开放编号 `10`–`9999`、数字连击彩蛋、整点报时。

## 当前功能入口

- **按序号点歌 / 选台**：`#` → 数字（可多位）→ `#`；优先匹配串流编号，否则点歌 `3`–曲目总数（`1` 随机 / `2` 红心不可选）
- **网页跳转**：`*` → 数字（`0`–`999999`）→ `*`；打开该编号绑定的网址，默认内置 `1` / `2` / `3`
- **设置 → 网络串流 → ＋ 添加**：可绑定实体键 `3`–`9`、`0`，或编号 `3`–`9999`（实际开放 `10`+，最多 1000 条；`#` / `*` 不可绑定）
- **设置 → 网页跳转 → ＋ 添加**：编号 `0`–`999999` → 网址，最多 1000 条
- 编号 > 9 没有实体键，只能通过 `#` 选号触发；实体键仍直接点击播放
- 直接按 `1` 随机 / `2` 红心；`3`–`9` 在曲库超过 15 首后解锁
- 绑定串流的键直接播放对应流，不再切换频道
- 曲目信息下方常驻「已导入 N 首 · 选号 3–N」

## 本次改动涉及的文件

| 文件 | 改动要点 |
| --- | --- |
| `app.js` | 网页跳转：`WEB_LINKS_KEY` / `MAX_WEB_NUM` / `MAX_WEB_LINKS` / `MAX_WEB_DIGITS` / `DEFAULT_WEB_LINKS` / `web` / `parseWebKey` / `loadWebLinks` / `saveWebLinks` / `renderWeb` / `startWebJump` / `webDigit` / `confirmWebJump` / `cancelWebJump` / `handleStarKey` / `flashDashLabel` / `openWebLink`；`STREAM_KEYS` 移除 `*`；设置面板新增网页跳转区块 |
| `app.js` | 播放记录：`HISTORY_KEY` / `MAX_HISTORY` / `loadHistory` / `saveHistory` / `recordPlay` / `presetRange` / `buildM3u` / `exportHistory` / `toLocalInputValue` / `parseLocalInputValue`；录制：`canRecordUrl` / `refreshRecordButton` / `startRecording` / `stopRecording` / `finalizeRecording` / `cleanupRecording`；`playTrack` 写记录并在切歌 / 切流时收尾录制；设置面板新增导出区块 |
| `style.css` | 新增 `.key.webjump` 呼吸、`.dash-link` 脉冲、`.dash-link-flash` 闪动；`.rec-btn` / `.rec-dot` / `recPulse`、`.export-box` / `.export-presets` / `.export-field` |
| `index.html` | 音乐推子下新增 `#btn-record`；`*` 键 aria-label 改为网页跳转；`style.css?v=11`、`app.js?v=12` |
| `sw.js` | `fm-pwa-v20` + ASSETS 版本同步 |
| `README.md` | 导出播放记录、录制、CORS / 格式 / 相对路径限制、版本号同步 |
| `memory-bank/` | 同步本次改动 |

## 关键行为约定（改动时别破坏）

1. `STREAM_KEYS = ['3','4','5','6','7','8','9','0']` 是**实体键**；`1`、`2` 永远不可绑定，`#` 专用于点歌 / 选台，`*` 专用于网页跳转
2. 串流编号额外支持 `3`–`9999`（`parseStreamKey` 归一化前导 0），最多 `MAX_STREAMS = 1000` 条；编号 > 9 只能通过 `#` 选号触发
3. 选号态由模块级 `dial = { active, buf, timer }` 维护；`DIAL_TIMEOUT = 5000`、`MAX_DIAL_DIGITS = 4`
4. 点击优先级：`#` → 选号逻辑；`*` → 网页跳转确认 / 取消选号 / 进入跳转；网页跳转态下数字 / `0` → 编号位；选号态下数字 / `0` → 数字位；否则再走串流 / 频道逻辑
5. 确认选号：先查 `state.streams[String(N)]` 播流，未命中再校验点歌范围 `3 ≤ N ≤ tracks.length`
6. 只有串流编号、曲目不足 3 首时仍可进入选号态（`hasNumericStreams()`）
7. `state.mode` 两态：`'local' | 'stream'`；`playTrack` 会重置 `mode` / `streamKey`
8. 网页跳转由模块级 `web = { active, buf, timer }` 维护；`WEB_TIMEOUT = 5000`、`MAX_WEB_DIGITS = 6`；`startWebJump()` 与 `startDial()` 互相 `cancel`，`*` 在选号态下优先取消选号
9. 网页跳转持久化键 `fm_webjumps`；`loadWebLinks()` 首次无数据时用 `DEFAULT_WEB_LINKS`，之后过滤非法编号 / 非 http(s) URL / 非字符串，最多 `MAX_WEB_LINKS = 1000`
10. 设置面板串流 / 网页跳转都用 `draft` 副本，点「完成」才提交；遮罩取消丢弃；容量上限 1000，重复 / 非法编号在前端拒绝
11. 删除正在播放的流 → 点完成后 `audio.pause()` 并回到 CH1
12. 主题类挂在 `<html>`；dashboard 用 `classList` 改 `theme-*`，不要用 `className=`
13. 整点报时只在 `state.playing` 为真时触发；`updateClock()` 每秒调用 `maybeChime()`，`分=0 且 秒≤2` 才算整点，`lastChimedKey` 去重、`chiming` 防重入
14. 报时前 `audio.pause()` 并记录 `chimeResume`，哔声 + TTS 结束后仅在 `state.playing` 仍为真时恢复；报时变量必须在 `updateClock` 首次调用前初始化（TDZ）
15. 播放记录只记本地曲目：`recordPlay()` 在 `playTrack()` 内调用；`state.history` 上限 `MAX_HISTORY = 2000`，持久化键为 `fm_history`
16. 导出时间范围以**本地时间**计算；`datetime-local` 只到分钟，结束时间需 `+59999ms`（UI 层处理），否则同分钟记录会被漏掉
17. 录制必须使用独立的 `Audio` 元素：**不要**对主播放器 `audio` 调 `createMediaElementSource`，否则跨域串流会被永久静音
18. 跨域串流只有同源或 CORS 允许时才可录制；`canRecordUrl()` 结果按 URL 缓存，`refreshRecordButton()` 用 token 防止异步结果覆盖新状态
19. 录制输出格式由浏览器决定（webm / ogg / mp4），不做转码；停止时 `recorder.onstop` → `finalizeRecording()` 生成 Blob 并下载

## 验证方式

```bash
node --check app.js && node --check sw.js
cd /tmp/fmtest && node test.js && node test-restore.js && node test-dial.js && node test-egg.js && node test-streams.js && node test-chime.js && node test-history.js && node test-record.js && node test-webjump.js
```

> `test-podcast.js` 是已移除播客功能时的旧脚本（依赖 `parseRss`），当前会报 `parseRss is not a function`，已废弃，不应再运行。

若 `/tmp/fmtest` 已不存在（临时目录可能被清理），需要重建 jsdom 脚本：
- `FakeAudio`（记录 src/volume、触发 play/pause/ended）
- `FakeAudioContext`（createGain/createBuffer/createBufferSource/createMediaElementSource）
- 注入 `window.eval(app + ';window.__state=state;window.__dial=dial;')` 后断言 DOM 与 localStorage
- `test-dial.js` 覆盖：进入/确认、`1`/越界拒绝、含 0 多位序号、`*`/传输键/5 秒超时取消、频道与串流不受影响
- `test-egg.js` 桩掉 `window.open`，覆盖 `19930214` / `930214` 触发、不完整与普通数字不触发、选号态触发后退出
- `test-streams.js` 覆盖 `parseStreamKey` 校验、`loadStreams` 1000 条上限、设置面板添加 `123`、重复 / 非法编号拒绝、`#10#` / `#99#` 播流、串流优先、未绑定回退点歌、删除后回 CH1
- `test-chime.js` 覆盖地点推断、12 小时制哔声次数、中文文案、未播放 / 非整点不触发、暂停与恢复、同一整点去重、非中国时区地点。需桩 `AudioContext.createOscillator`、`speechSynthesis`、`Intl.DateTimeFormat`
- `test-history.js` 覆盖 `recordPlay` 写入与 2000 条上限、预设区间、`datetime-local` 互转、M3U 内容、区间过滤 / 空区间、`loadHistory` 脏数据过滤，以及设置面板导出按钮的 DOM 接线
- `test-record.js` 覆盖同源 / CORS 可录制判定与缓存、按钮禁用文案、本地 / 串流录制（`crossOrigin`）、停止后下载文件名、跨域拒绝开始。需桩 `MediaRecorder`、`AudioContext.createMediaStreamDestination`、`fetch`
- `test-webjump.js` 覆盖默认映射、`parseWebKey` 校验、`*` 旧串流被丢弃、进入 / 多位编号 / 未绑定 / 单独 0 / 空输入、`window.open` 参数、与选号互斥、设置面板增删与校验、`loadWebLinks` 读取过滤

## 待用户确认

- 目标平台是否包含 **iOS Safari**？（`HTMLMediaElement.volume` 在 iOS 只读，音乐推子需改 GainNode）

## 下一步（按优先级）

1. 浏览器手测导出：播放几首本地曲目 → 设置 → 今天 / 近 7 天 / 自定义区间 → 检查下载的 `.m3u` 内容
2. 浏览器手测录制：本地曲目与同源串流各录一段，确认有声音；再试一个无 CORS 的跨域流，确认按钮置灰
3. 在 Chrome / Safari 分别确认录音格式（webm / mp4）与下载行为
4. 浏览器手测编号选台、点歌、网页跳转（`*` → 编号 → `*`）、整点报时（详见上一轮）
5. 提交本轮改动（导出 + 录制；`memory-bank/` 仍未跟踪）
6. 视需要补 `.gitignore`（`.venv/`、`.DS_Store`、`*.bak`）

## 快速排查

| 现象 | 排查点 |
| --- | --- |
| 改了代码浏览器没变 | `sw.js` 的 `CACHE` 是否 bump；`index.html` 查询串是否 bump；DevTools 里 Unregister SW |
| 按键不显示流名 | `refreshChannels()` / `refreshStreamKeys()` 是否在保存后调用 |
| `*` 键没进入网页跳转 | 是否在选号态（此时 `*` 先取消选号）；`handleStarKey()` 是否接管 `*` 点击 |
| 网页跳转没打开 | 编号是否在设置里保存并点了「完成」；浏览器是否拦截弹窗；URL 是否 http(s) |
| 串流没声音 | URL 是否 https、格式是否浏览器支持、Console 是否有 `error`/CORS 报错 |
| `#` 键没进入选号 | 曲库是否 ≥ 3 首，或是否已绑定编号 > 9 的串流；`#` 的点击是否被 `handleHashKey()` 接管 |
| 编号选台没反应 | 设置里编号是否被 `parseStreamKey()` 接受（3–9999，不能是 1/2）；保存后是否点「完成」；是否超出 1000 条上限 |
| 点歌跳到错误的歌 | 序号按导入顺序计算，重新导入 / 恢复后顺序可能变化 |
| 整点没有报时 | 是否正在播放；标签页是否被后台节流；`updateClock` 是否每秒运行；`lastChimedKey` 是否已记录该小时 |
| 报时后没有继续播放 | 浏览器是否拒绝了非手势 `audio.play()`；控制台是否有 `NotAllowedError` |
| 设置弹层被截断 | `.sheet` 的 `max-height: 88vh; overflow-y: auto` 是否被覆盖 |
| 导出的 .m3u 为空 | 该时段是否有本地曲目播放记录；`fm_history` 是否有数据；起止时间是否颠倒 |
| 导出的曲目找不到 | 文件夹导入无相对路径，`.m3u` 只有文件名；需保证文件与播放列表同目录 |
| ⏺️ 按钮置灰 | 是否正在播放；串流是否跨域且无 CORS；浏览器是否支持 `MediaRecorder`（iOS 有限） |
| 录到的文件没声音 | 串流虽能播放但无 CORS 时录音必为静音；确认 `canRecordUrl()` 返回 true |
| 录音没有下载 | 是否点了停止；`recorder.onstop` 是否触发；`Blob` 是否为空（重试录制） |

