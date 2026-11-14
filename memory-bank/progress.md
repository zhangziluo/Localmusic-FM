# 进度记录（Progress）

> 最后更新：2026-11-14

## 已完成里程碑

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| v0 初版 | 本地文件夹导入、随机播放、iPod shuffle 感 | ✅ |
| v1 文档 | README 完整化 | ✅ |
| v2 字体/按键 | DSEG14 数码管字体、九宫格数字键盘、CH 频道概念 | ✅ |
| v3 界面主题 | 新增 3 个整页主题（crt / cream / tube），5 主题 + 8 强调色，深色主题可读性修复 | ✅ |
| v4 网络串流 | 设置内添加串流、绑定 3-9 / `*` / `0` / `#`、直播播放适配 | ✅ |
| 精简（未提交） | 移除 RSS 播客功能，`#` 恢复为普通网络串流绑定键 | ✅ |
| v5 点歌（未提交） | `#` → 数字 → `#` 按序号跳转；`#` 退出网络串流绑定；新增常驻「已导入 N 首」 | ✅ |
| 彩蛋（未提交） | 数字键连击 `19930214` / `930214` → 新窗口打开 `create.myfami.cn` | ✅ |
| v6 串流编号（未提交） | 串流可绑定 `10`–`9999` 编号，`#` 选号播流（串流优先），最多 1000 条 | ✅ |
| v7 整点报时（未提交） | 播放中整点：12 小时制哔声（Web Audio）+ 系统 TTS 报时，时区推断地点，暂停后自动恢复 | ✅ |
| v8 导出 + 录制（未提交） | 本地曲目播放记录（`fm_history`，2000 条）按时间范围导出 `.m3u`；音乐推子下方 ⏺️ 录制本地 / 串流，跨域无 CORS 时禁用 | ✅ |
| v9 网页跳转（未提交） | `*` → 数字（`0`–`999999`）→ `*` 在新窗口打开绑定网址；内置 22 条默认；`fm_webjumps` 最多 1000 条；`*` 移出网络串流键位 | ✅ |
| v10 剪贴板识别串流（未提交） | 复制典型串流地址后粘贴 / 窗口聚焦即提示「检测到串流地址」，预填名称与空闲按键，一键绑定；设置可关闭；忽略的地址本次会话不再提示 | ✅ |
| v11 导入进度条（未提交） | 授权后顶部浮层显示扫描 / 读取进度与「成功 X / 总数 N」；6 路并发读取、坏文件跳过；恢复曲库与回退路径复用同一进度 | ✅ |

## 当前实现清单

- 曲库：递归扫描、覆盖/追加导入、索引持久化、文件夹句柄自动恢复（Chromium）；导入 / 恢复时顶部显示进度（扫描「已找到 N 首」→ 读取「成功 X / 总数 N」），6 路并发读句柄
- 导入进度：`#import-progress` 固定顶部浮层；`setImportProgress()` 合并到 rAF 渲染，`flushImportProgress()` 收尾同步刷新，`hideImportProgress()` 延迟收起；失败文件只跳过
- 播放：随机、收藏频道 CH2、CH3-9（>15 首解锁）、上一首/下一首随机
- 网络串流：实体键 `STREAM_KEYS = 3-9 0` 一键一流；另可绑定编号 `10`–`9999`，通过 `#` 选号播放；直播流进度条 100%，删除后停止
- 串流编号：`parseStreamKey()` 校验 / 归一化，`loadStreams()` 最多读取 1000 条；设置面板文本框输入 + 用量显示（`N / 1000`），重复 / 非法编号拒绝
- 按序号点歌：`#` 进入 → 多位数字 → `#` 确认；先匹配串流编号，未命中再按曲目序号；`1`/`2` 与越界拒绝，`*`/传输键/5 秒超时取消；授权失效时先恢复再跳转
- 网页跳转：`*` 进入 → 多位数字（`0`–`999999`）→ `*` 确认；`fm_webjumps` 保存编号 → 网址（内置 22 条：电台站点 + `110`/`119`/`12345` 等公共服务，最多 1000 条）；数码屏 `↗编号` 闪烁，`*` 键呼吸提示
- 剪贴板识别串流：`detectStreamUrl()` 按扩展名白名单 / 路径关键词 / Icecast 端口识别地址；文档 `paste` + 窗口 `focus` / `visibilitychange`（需已授权）触发；底部提示条 `.stream-detect` 可改名称 / 按键后「添加绑定」，绑定写入 `fm_streams` 并刷新键位；已绑定地址只更新 LED，忽略的地址本次会话不再提示；开关存 `fm_config.clipboardStream`
- 整点报时：播放中整点触发，`updateClock()` 每秒检查；12 小时制哔声 + 系统 TTS「现在是〔地点〕时间〔时段〕〔中文小时〕点整」；地点按设备时区推断；报时暂停播放、结束恢复；同小时去重
- 播放记录：`recordPlay()` 在每次 `playTrack()` 时写入 `fm_history`（`{ name, fileName, path, ts }`，最多 2000 条）
- 导出：设置面板「导出播放记录」支持今天 / 昨天 / 近 7 天 / 自定义起止，生成 `fm-YYYYMMDD-HHMMSS.m3u`（仅本地曲目）
- 录制：`#btn-record`（音乐推子下方），独立 Audio 元素 + `MediaElementSource` + `MediaStreamDestination` + `MediaRecorder`；同源或 CORS 允许的串流才可录；输出 webm / ogg / mp4
- 音量：音乐 / 底噪双竖推子，实时平滑
- 主题：dark / led / crt / cream / tube + 主题色圆点 + meta theme-color
- 底噪：粉红噪声 + 海浪混合，仅播放时出现
- 数据卡片：实时时钟、CH（串流时显示键位）、累计时长（9999:59:59 归零 + 0.2s 重启动画）
- PWA：SW 离线缓存 fm-pwa-v23、manifest、安装
- 设置面板：主题色 / 界面主题 / 底噪 / 口播间隔 / 剪贴板识别串流 / 网络串流 / 网页跳转 / 导出播放记录 / 完成
- 快捷键：Space、←、→、0-9、`*`、`#`（`#` 进入/确认选号，`*` 进入/确认网页跳转，选号态下 `*` 取消）

## 最近一次变更（导入进度条）

- 结构：`index.html` 在 `#app` 顶部新增 `#import-progress`（`hidden` + `.show` 滑入）；内部 `.ip-row`（`#ip-text` 文案 / `#ip-count` 计数）+ `.ip-track` / `#ip-fill` 进度条；不确定态由 `.ip-track.indeterminate` 的 `ip-slide` 动画表示
- 控制：`showImportProgress(label)` 打开并清空旧计数 → `setImportProgress(patch)` 合并状态并调度一帧 rAF → `flushImportProgress()` 同步渲染 → `hideImportProgress(delay)` 延迟收起并复位；`renderImportProgress()` 在有总数时显示 `成功 X / 总数 N`（+ `· 失败 Y`），无总数时显示 `已找到 N 首`
- 读取：`scanDirectory(dir, list, onFound)` 每发现音频回调一次；`tracksFromHandle(dir, onProgress)` 先扫描得总数，再 `mapWithLimit(handles, 6, ...)` 并发 `getFile()`（保持原顺序），失败只累加 `failed` 并跳过
- 覆盖导入：扫描文案「正在扫描文件夹」→ 读取文案「正在导入曲目」→ 完成「导入完成」；LED 带失败数（`已导入 N 首 · Y 首失败`）；空目录提示「未找到可导入的音频文件」
- 追加导入：读取文案「正在追加曲目」，LED `已追加 N 首`
- 自动恢复：`restoreLibrary()` 显示「正在恢复曲库」→「恢复完成」，失败时立即收起
- 回退路径（Safari / Firefox）：`#folder-input` 逐首建立曲目，每 100 首 `yieldToUI()` 一次并更新进度
- 回归：新增 `/tmp/fmtest/test-import-progress.js`（30 条断言），其余 10 个脚本全部通过

版本：
- `style.css?v=13`、`app.js?v=15`、SW `fm-pwa-v23`

## 最近一次变更（剪贴板串流识别）

- 识别：`detectStreamUrl(text)` 取首个 `http(s)` 链接并去掉收尾标点；`STREAM_EXTS` 白名单命中即接受；页面 / 图片 / 压缩包等 `NON_STREAM_EXTS` 直接拒绝；否则按 `STREAM_HINTS`（`stream` / `live` / `radio` / `listen` / `icecast` / `shoutcast`）与 `STREAM_PORTS`（`8000` / `8001` / `8080` / `8443` / `9000`）兜底
- 名称：`guessStreamName(url)` 用路径末段去扩展名、分隔符换空格，过短则回落域名
- 触发：文档级 `paste`（输入控件 / `contenteditable` 内跳过）为主；`window.focus` / `visibilitychange` → `readClipboardOnFocus()`，仅在已授权且页面有用户操作后读取，连续失败两次本会话不再尝试
- 弹窗：`showStreamDetectDialog(url)` 动态创建 `.stream-detect`，预填名称与 `allocateStreamKey()` 分配的空闲键；`Enter` 提交，`Esc` / `×` / 「忽略」写入会话级 `dismissedStreamUrls`
- 提交：`parseStreamKey` 校验（保留键 / 占用 / 容量）→ 写 `state.streams` → `saveStreams()` → `refreshChannels()` + `refreshStreamKeys()` → LED `已绑定N 键 · 名称`；不自动播放
- 已绑定地址：只把 LED 改成 `该串流已绑定到 N 键/号`，不重复弹窗；设置面板打开时不打扰
- 设置：新增「剪贴板识别串流」下拉 `#s-clip`，保存到 `fm_config.clipboardStream`（默认开启）
- 键位分配：抽出全局 `allocateStreamKey(map)`，设置面板 `nextFreeStreamKey()` 改为复用它
- 回归：新增 `/tmp/fmtest/test-clipboard.js`（48 条断言），其余脚本全部通过

版本：
- `style.css?v=12`、`app.js?v=14`、SW `fm-pwa-v22`

## 最近一次变更（网页跳转）

- 常量：`WEB_LINKS_KEY = 'fm_webjumps'`、`MAX_WEB_NUM = 999999`、`MAX_WEB_LINKS = 1000`、`MAX_WEB_DIGITS = 6`、`WEB_TIMEOUT = 5000`
- 内置默认：`DEFAULT_WEB_LINKS` 共 22 条（`1`–`3` 电台站点 + 19 条有官网的公共服务；`911`/`999`/`404` 无地址未内置）；`WEB_LINK_NAMES` 提供中文名
- 默认升级：`WEB_SEED_KEY = 'fm_webjumps_seed'`、`WEB_SEED_VERSION = 2`；首次全量写入，老数据只在版本提升时补全缺失编号（不覆盖用户改动）
- 状态机：模块级 `web = { active, buf, timer }`；`startWebJump()` / `webDigit()` / `confirmWebJump()` / `cancelWebJump()` / `handleStarKey()`
- 校验：`parseWebKey()` 接受 `0`–`999999`（前导 0 归一化）；`loadWebLinks()` 首次用默认，之后过滤非法编号 / 非 `http(s)` / 非字符串
- 交互：`*` → 数字 → `*`；数码屏 `#dash-ch` 显示 `↗` / `↗编号`，`#dashboard` 加 `.dash-link` 脉冲、确认后 `.dash-link-flash` 闪动；`*` 键加 `.webjump` 呼吸
- 展示：设置列表项为 `↗ 编号 名称`（名称仅在内置地址未被修改时显示）；确认跳转时 LED 为 `网页跳转 · 名称（url）`
- 互斥：`startWebJump()` ↔ `startDial()` 互相取消；播放 / 切歌键、彩蛋触发、5 秒超时都退出跳转态
- 设置：新增「网页跳转」区块（`#s-web-list` / `#s-web-form` / `webDraft`），点「完成」提交并 `saveWebLinks()`
- 迁移：`STREAM_KEYS` 移除 `*`，`parseStreamKey('*')` 返回 `null`，旧 `*` 串流绑定在 `loadStreams()` / 重启后被丢弃
- 样式：`.key.webjump`、`.dash-link` 脉冲、`.dash-link-flash`

版本：
- `style.css?v=11`、`app.js?v=13`、SW `fm-pwa-v21`
- `app.js` 启动日志：`极简FM · app.js?v=13 已加载`

## 最近一次变更（导出播放记录 + 录制）

播放记录 / 导出：
- 常量：`HISTORY_KEY = 'fm_history'`、`MAX_HISTORY = 2000`
- 写入：`recordPlay(t)` 在 `playTrack()` 内调用，追加 `{ name, fileName, path, ts }`，超出上限丢弃最旧
- 范围：`presetRange('today'|'yesterday'|'week', now?)` 以本地零点为界；`toLocalInputValue()` / `parseLocalInputValue()` 负责 `datetime-local` 互转
- 生成：`buildM3u(list)` = `#EXTM3U` + 每行 `path || fileName || name`；导出按 `ts` 升序
- UI：设置面板「导出播放记录」预设按钮 + 起止输入 + 导出按钮；结束时间按分钟末（`+59999ms`）处理
- 下载：`Blob` + `<a download>`，文件名 `fm-YYYYMMDD-HHMMSS.m3u`；空区间不下载

录制：
- 判定：`canRecordUrl(url)` 同源直接 true，跨域 `fetch(url, { mode:'cors' })` 成功才 true，结果按 URL 缓存
- 按钮：`refreshRecordButton()` 依 `state.playing` / `mode` / CORS 结果设置 `disabled` 与 `title`；异步 token 防过期
- 启动：`startRecording()` 用独立 `new Audio()`（跨域设 `crossOrigin='anonymous'`）→ `createMediaElementSource` → `createMediaStreamDestination` → `MediaRecorder`
- 停止：`stopRecording()` → `recorder.onstop` → `finalizeRecording()` 合并 Blob 并下载；`cleanupRecording()` 断开节点、回收 URL
- 收尾：`playTrack()` / `playStream()` 切歌切流时若在录制先 `stopRecording(true)`
- 格式：`audio/webm;codecs=opus` → `audio/webm` → `audio/ogg;codecs=opus` → `audio/mp4`

版本：
- `style.css?v=10`、`app.js?v=11`、SW `fm-pwa-v19`
- `app.js` 启动日志：`极简FM · app.js?v=11 已加载`

## 上一轮变更（整点报时 + 按序号点歌 + 串流编号）

整点报时：
- 常量/状态：`CHIME_BEEP_HZ = 880`、`CHIME_BEEP_LEN = 0.14`、`CHIME_BEEP_GAP = 0.26`；模块级 `chiming` / `lastChimedKey` / `chimeResume`（必须在 `updateClock` 首次调用前初始化，避免 TDZ）
- 触发：`updateClock()` 每秒调用 `maybeChime(now)`；仅 `state.playing` 为真、`分 === 0`、`秒 ≤ 2` 时触发；`lastChimedKey = 年-月-日-时` 去重
- 哔声：`playChimeBeeps(count, done)` 复用 `ensureNoiseCtx()`，用 `OscillatorNode` 合成 880Hz 短音，count = `chimeHour12(hour)`（0/12 点 = 12 声）
- 文案：`buildChimeText()` = `现在是${地点}时间${时段}${中文小时}点整`；时段 `凌晨/上午/中午/下午/晚上`，中文数字 2 读「两」
- 地点：`resolveLocation(tz)`；中国时区 → `北京`；内置常见城市中译；其余取时区城市段
- TTS：`speakChime()` 用 `speechSynthesis`；`onend` / `onerror` / 超时兜底后 `finishChime()`
- 暂停/恢复：报时前 `audio.pause()` 并记录 `chimeResume`；结束后仅当 `state.playing` 仍为真才 `audio.play()`
- LED：报时期间显示「整点报时」

串流编号：
- 常量：`MAX_STREAMS = 1000`、`MAX_STREAM_NUM = 9999`；`STREAM_KEYS` 仍只表示九宫格实体键
- 校验：`parseStreamKey(raw)` 接受 `3`–`9`、`*`、`0` 与编号 `3`–`9999`（前导 0 归一化，`1`/`2`/`#`/5 位以上拒绝）；`isNumericStreamKey()` 区分编号与实体键；`sortStreamKeys()` 排序列表
- 存储：`loadStreams()` 遍历任意键并限制 1000 条；设置面板用 `draft` + 文本输入，重复 / 非法 / 超限时在 `#s-stream-err` 提示；标题右侧显示 `N / 1000`
- 播放：`confirmDial()` 先查 `state.streams[String(N)]`，命中则 `cancelDial(true)` + `playStream()`；未命中再按 `3 ≤ N ≤ tracks.length` 点歌
- 选号：`hasNumericStreams()` 让「只有串流、曲目不足 3 首」的用户仍能进入选号态；提示文案由 `dialHintText()` 组合
- UI：编号 > 9 的串流在 `#track-sub` 显示「N 号 · 网络直播」（实体键仍为「N 键」）

点歌：
- 常量/状态：`dial = { active, buf, timer }`、`DIAL_TIMEOUT = 5000`、`MAX_DIAL_DIGITS = 4`
- 选号逻辑：`dialHintText` / `renderDash` / `renderDial` / `armDialTimer` / `cancelDial` / `startDial` / `dialDigit` / `jumpToTrack` / `confirmDial` / `handleHashKey`
- 交互：`#` 进入 / 确认；选号态下数字键与 `0` 作为数字位、`*` 取消；播放 / 切歌键取消
- 跳转：`N = state.tracks[N-1]`，校验 `3 ≤ N ≤ tracks.length`；授权失效时先 `ensurePlayable()` 再按文件名找回
- UI：`#dash-ch` 显示 `#` + 输入；`#lib-count` 常驻「已导入 N 首 · 选号 3–N」；`.key.dialing` 呼吸动画

彩蛋：
- 常量：`EGG_CODES = ['19930214', '930214']`、`EGG_URL = 'https://create.myfami.cn/'`、`EGG_TIMEOUT = 4000`
- 状态：`eggBuf`（保留最近 8 位）、`eggTimer`
- 逻辑：`recordEggDigit()` 在数字键点击时先记录，命中后 `return true` 终止常规按键处理；`openEasterEgg()` 取消选号并 `window.open(..., '_blank', 'noopener,noreferrer')`
- 触发后 LED 提示「彩蛋已触发 · 正在打开…」

调整内容：
- `STREAM_KEYS` 去掉 `#` → `['3','4','5','6','7','8','9','*','0']`；`loadStreams()` 自动忽略历史 `#` 绑定
- `refreshStreamKeys()` 对 `#` 固定显示「点歌」

版本（上一轮）：
- `style.css?v=9`、`app.js?v=10`、SW `fm-pwa-v18`
- `app.js` 启动日志：`极简FM · app.js?v=10 已加载`

上一轮（已保留）：移除 RSS 播客，`state.mode` 仅 `local` / `stream`，删除播客数据层与 `fm_podcasts`。

## 验证记录

```
node --check app.js / sw.js                              → OK
jsdom（/tmp/fmtest/test.js、test-restore.js、test-dial.js、test-egg.js、test-streams.js、test-chime.js、test-history.js、test-record.js）→ 全部通过
```

> `test-podcast.js` 属于已移除的播客功能，依赖 `parseRss`，已废弃。

选号测试覆盖：
```
  · 初始 lib-count / # 键小字=点歌 / 旧 # 绑定被丢弃   ✔
  · 曲目不足 3 首拒绝选号                              ✔
  · 导入 20 首后 # → 1 → 2 → # 跳到第 12 首            ✔
  · 序号 1、空输入、越界、首位 0 的拒绝与提示          ✔
  · 含 0 的多位序号（#20）跳转                         ✔
  · * / 切歌键 / 5 秒超时取消与数码屏恢复              ✔
  · 选号态下 3 作为数字位、不切频道                    ✔
  · 彩蛋 19930214 / 930214 触发、普通数字不触发        ✔
```

串流编号测试覆盖（test-streams.js）：
```
  · parseStreamKey：10 / 010 / 3 / 0 通过，1/2/10000/#/* 拒绝      ✔
  · loadStreams：旧 # / 1 / 5 位编号 / 非法键被过滤，上限 1000  ✔
  · 设置面板：默认分配、添加 123、重复/非法拒绝、留空自动分配  ✔
  · #10# / #99# 播流（99 超出曲目数）、#3# 串流优先于频道     ✔
  · #12# 未绑定回退点歌；删除编号后不再播流                   ✔
  · 删除正在播放的 0 后停止并回到 CH1                          ✔
```

整点报时测试覆盖（test-chime.js）：
```
  · 中国时区→北京、东京/纽约中译、未知时区取城市名、无时区→UTC  ✔
  · 0/12 点 12 声、13 点 1 声、23 点 11 声                      ✔
  · 13/0/12/23 点中文文案（下午一点 / 凌晨十二点 / 中午十二点 / 晚上十一点） ✔
  · 未播放不报时、非整点（分钟≠0、秒>2）不报时                  ✔
  · 13 点集成：1 声、暂停音乐、TTS 文案、结束后恢复播放          ✔
  · 东京时区 14 点：2 声 + 「现在是东京时间下午两点整」          ✔
  · 同一整点只报一次（去重）                                     ✔
```

网页跳转测试覆盖（test-webjump.js）：
```
  · 内置 22 条默认；1/2/3 电台站点，110/12306/12117/95598 正确；911/404 未内置 ✔
  · parseWebKey：0/1/010/999999 通过，1000000/abc/-1 拒绝         ✔
  · 旧 * 串流绑定被 loadStreams 丢弃；* 键小字=跳转               ✔
  · * 进入跳转：数码屏 ↗、* 键呼吸、LED 提示                      ✔
  · 编号 1 / 多位 10 / 单独 0 打开对应 URL；window.open 新窗口 + noopener ✔
  · 未绑定提示且不打开；空输入只提示不退出                        ✔
  · 与选号互斥（选号态 * 取消；startWebJump 退出选号）            ✔
  · 设置列出默认 1/2/3 + 内置 110（显示「报警」）、非法/超限/重复拒绝、添加 20、删除 3、持久化 ✔
  · loadWebLinks 过滤：04→4 归一化、超限/非法键/非 http/非字符串丢弃 ✔
  · seed 补全：缺失 110/12345 补齐、保留自定义 1/50、写入 seed=2、命中后不复活已删内置 ✔
```

历史记录（网络串流，v4）：
```
  · 双推子、主题切换与取消回滚              ✔
  · 可绑定键位不含 1/2                     ✔
  · `#` / `*` / `0` 可绑定串流             ✔
  · 添加串流 → fm_streams 写入             ✔
  · 按键显示流名、点击播放、删除后取消不丢 ✔
  · 预置 fm_streams 重启恢复、非法地址过滤 ✔
```

## 已知问题 / 限制

1. **iOS Safari 的音乐音量**：`HTMLMediaElement.volume` 在 iOS 上只读，musicVolume 推子可能无效；曾计划用 Web Audio GainNode 包一层，尚未实现（平台未确认）
2. **HLS（.m3u8）**：Chrome / Firefox 不能直接播放，Safari 原生支持
3. **mixed content**：https 页面无法播放 http 的流
4. **口播间隔**：仅保存数值，未实现真正的口播插入
5. **收藏按文件名去重**：不同目录同名曲目会互相覆盖
6. **自动恢复文件夹**：仅 Chromium；Safari/Firefox 每次需重新选择
7. **无 Media Session / 锁屏控制**
8. **时长上限**：9999:59:59 后归零（设计如此，会触发重启动画）
9. **仓库状态**：`b2becff` 已包含 v4 网络串流；本轮改动（移除播客 + 按序号点歌 + 彩蛋 + 串流编号 + 整点报时 + 导出 + 录制 + 网页跳转，涉及 app.js / style.css / index.html / sw.js / README / memory-bank）尚未提交
10. **整点报时依赖系统 TTS**：缺少中文语音时可能读英文或不出声；后台标签页定时器被节流时可能延迟 / 跳过
11. **报时恢复受自动播放策略影响**：非用户手势下 `audio.play()` 可能被拒绝，报时结束后停在暂停状态
12. **导出的 .m3u 可能只有文件名**：File System Access 导入拿不到相对路径；文件分散在子目录时播放器无法定位
13. **跨域串流不能录制**：无 `Access-Control-Allow-Origin` 时只能录到静音，按钮会置灰；属浏览器安全限制
14. **录音格式不是 mp3**：只有 webm / ogg / mp4（取决于浏览器），不做转码；iOS Safari 支持有限
15. **录音仅从点击时刻开始**：直播流从建立录制连接时起录；页面被强制关闭时最后一段（最多 1 秒）可能丢失

## 关键决策记录

| 决策 | 选择 | 原因 |
| --- | --- | --- |
| 主题字段 | 复用 `state.cardStyle`，扩展值域 | 兼容旧配置，避免新增迁移逻辑 |
| 主题类挂载点 | `<html>`（`html.skin-*`） | 让 html 背景也跟着变，避免 iOS 回弹露白 |
| 串流与 CH3-9 冲突 | **绑定后该键专职播流**（用户确认） | 最贴合"可绑定到数字键"的直觉 |
| 1/2 不可绑定 | 硬编码在 `STREAM_KEYS` | 保留随机 / 红心核心功能 |
| 串流保存时机 | 面板内 draft，点"完成"提交 | 与主题预览/取消回滚行为一致 |
| 移除播客 | 回到 v4 网络串流基线，`#` 重新作为串流键 | 用户要求删除播客功能 |
| 点歌交互 | **保留频道**：`#` 进入选号态 → 数字 → `#` 确认（用户确认） | 3-9 短按仍要切频道，需要独立前缀 |
| `#` 与串流 | 把 `#` 从 `STREAM_KEYS` 移除 | 避免与点歌前缀冲突；旧绑定自动失效 |
| `*` 与串流 | 把 `*` 从 `STREAM_KEYS` 移除，改作网页跳转前缀 | 与 `#` 点歌对称；旧 `*` 绑定在 load 时丢弃 |
| 网页跳转交互 | **`*` → 数字 → `*` 确认**（用户确认） | 与点歌一致的前缀 + 确认心智；避免误触弹窗 |
| 网页编号范围 | `0`–`999999`（6 位，用户确认） | 足够容纳大量站点；`0` 也合法 |
| 网页默认值 | 内置 22 条：`1`–`3` 电台站点 + 19 条有官网的公共服务（`110`/`119`/`120`/`122`/`114`/`12117`/`12121`/`12122`/`12123`/`12306`/`12315`/`12320`/`12333`/`12345`/`10000`/`10010`/`10086`/`95598`/`163`） | 公共服务编号开箱可用 |
| 无官网编号 | `911` / `999` / `404` 不内置 | 不臆造地址；按 `*` 输入时提示未绑定 |
| 默认值升级 | `fm_webjumps_seed` 版本号控制一次性补全 | 老用户能拿到新内置编号，同时不覆盖自定义、不复活已删项 |
| 网页容量 | `MAX_WEB_LINKS = 1000` | 与串流上限一致，避免 localStorage 膨胀 |
| 序号口径 | 1 起算、按 `state.tracks` 顺序，有效 `3 ~ tracks.length` | 与用户「1 随机 / 2 红心」的心智一致 |
| 多位输入 | 支持最多 4 位，首位不能是 0 | 大曲库需要；避免 `03` 这类歧义 |
| 跳转后下一首 | 仍是随机，不建立顺序队列 | 保持 iPod shuffle 的核心体验 |
| 彩蛋实现 | 全局数字连击缓冲 + 后缀匹配，4 秒过期 | 不打断频道 / 选号逻辑；`930214` 作为 `19930214` 的短码也能触发 |
| 报时小时制 | **12 小时制**（用户确认）：13 点 = 1 声、「下午一点整」 | 符合传统报时钟直觉，避免 23 点响 23 声 |
| 报时地点 | **时区推断**（用户确认）：中国时区 → 北京，其余 → 当地城市 | 离线零依赖，不请求第三方 IP 接口 |
| 报时期间播放 | **暂停音乐/串流**（用户确认）：报完自动继续 | 报时清晰，不被音乐盖住 |
| 报时音色 | Web Audio `OscillatorNode` 880Hz 短音 | 零音频资源、可精确控制声数与节奏 |
| 音频跨域 | `<audio>` 直接播放远程流，不经代理 | 省流量、避免第三方代理限流 |
| 测试方式 | 仓库外用 jsdom 临时脚本 | 项目零依赖，不引入测试框架 |

## 下一步建议

- [ ] 确认目标平台是否包含 iOS Safari；若是，实现 musicVolume 的 GainNode 方案
- [ ] 需要时增加 HLS 支持（引入 hls.js 或仅提示 Safari）
- [ ] 实现"口播间隔"（需要口播音频资源）
- [ ] 用真实 https 电台流做一次浏览器端手测（Icecast mp3/aac）
- [ ] 提交本轮改动（移除播客 + 按序号点歌）与 `memory-bank/`；如需可补 `.gitignore`（`.venv/`、`.DS_Store`、`*.bak`）
- [ ] 浏览器手测点歌（含授权失效后恢复再跳转，以及选号态下键盘输入）
- [ ] 浏览器手测网页跳转：`*` → `1` → `*` 是否打开 streamurl.link；再试未绑定编号与 5 秒超时
- [ ] 浏览器手测整点报时：可在 Console 执行 `maybeChime(new Date(2026,0,1,13,0,0))` 强制触发一次（需先播放）
- [ ] 可选：Media Session API（锁屏信息 / 媒体键）
