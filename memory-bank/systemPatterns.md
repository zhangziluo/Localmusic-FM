# 系统模式（System Patterns）

## 总体架构

单页 + 单脚本，无模块系统。`app.js` 按区块顺序组织，全部依赖挂在一个全局 `state` 对象上，选号态另有模块级 `dial`：

```
IndexedDB helpers → 常量（STREAM_KEYS / HISTORY_KEY / WEB_LINKS_KEY）→ state + history + dial + web + 报时态 + 录制态
→ 主题 → init(IIFE) → 时钟/时长（含整点报时）→ 音频/底噪 → 播放记录 → 曲库播放 → 录制 → 推子 → 控制栏 → 导入/恢复
→ 频道+网络串流 → 按序号点歌 → 网页跳转 → 设置面板 → 键盘 → SW 注册
```

## 核心状态 `state`

```js
{
  tracks: [], played: [], current: null, playing: false,
  noiseOn, noiseVolume, voiceInterval, musicVolume,
  totalPlayTime, playStartTime, rebooting,
  ch: 1, accent: '#ff8c42', cardStyle: 'dark',
  favorites: Set,
  streams: {},          // '3'-'9' | '0' → { name, url }（'#' 选号、'*' 网页跳转，不可绑定）
  mode: 'local',        // 'local' | 'stream'
  streamKey: null,      // 当前播放流绑定的键位
  webLinks: {},         // 网页跳转编号 → URL（'*' 前缀触发），持久化到 fm_webjumps
  history: [],          // [{ name, fileName, path, ts }]，最多 2000 条，持久化到 fm_history
}
```

选号态单独用模块级对象保存（不进入 `state`，也不持久化）：

```js
const dial = { active: false, buf: '', timer: 0 };
const DIAL_TIMEOUT = 5000;   // 5 秒无操作自动取消
const MAX_DIAL_DIGITS = 4;   // 最多 4 位序号

// 网页跳转态（同样不进入 state、不持久化运行态）
const web = { active: false, buf: '', timer: 0 };
const WEB_TIMEOUT = 5000;    // 5 秒无操作自动取消
const MAX_WEB_DIGITS = 6;    // 0–999999
const MAX_WEB_LINKS = 1000;
```

约定：
- `state.ch` 本地频道时是**数字**，播放串流时是**键位字符串**（实体键 `'3'`、`'*'`，或编号 `'12'`）
- 判断是否可重置频道用 `typeof state.ch === 'number'`（因此串流不会在曲库变化时被回退）
- `state.current` 只在本地曲目时有值；串流播放时为 `null`

## 播放模型

- 全局唯一 `audio = new Audio()`
- 本地：`playTrack(t)` → `URL.createObjectURL(t.file)`，切换时 `revokeObjectURL(prevUrl)`
- 串流：`playStream(key, stream)` → `audio.src = stream.url`，进度条固定 100%
- `mode` 决定事件分支：
  - `ended`：stream 不自动切歌，只提示「网络串流已结束」；local → `pickNext()`
  - `timeupdate`：stream 不按 duration 计算，进度条固定 100%；local 正常
  - `#btn-play`：stream 直接 pause/play；local 有 `current` 检查
  - `#btn-next` / `#btn-prev`：始终 `playRandom()`（自动退出串流状态）
  - `error`：stream 提示「串流加载失败 · 地址或网络异常」
- 累计收听时长与底噪逻辑与播放模式无关（依赖 audio 的 `play`/`pause`）

## 按键系统

- 屏幕按键两套 data 属性：`data-ch="1..9"`（数字）与 `data-key="*|0|#"`（符号）
- 统一工具：
  - `getKeyButton(key)` —— 兼容两种 data 属性查找
  - `setKeySmall(btn, text, visible)` —— 维护按键小字，空字符串移除元素
  - `refreshChannels()` —— 数字键：绑定流 > CH1/2 固定标签 > 3-9 解锁态；必要时回退 CH1；同时刷新 `#lib-count`
  - `refreshStreamKeys()` —— `*` / `0`：绑定流显示流名，否则恢复占位；`#` 固定显示「点歌」
- 点击优先级（数字键）：网页跳转态 → `webDigit()` > 选号态 → `dialDigit()` > 绑定流 → `playStream()` > 频道 / 解锁逻辑
- `*` 点击：网页跳转态 → 确认跳转；选号态 → 取消选号；否则进入网页跳转（`handleStarKey()`）
- `0` 点击：网页跳转态 / 选号态作为编号位，否则绑定流就播放
- `#` 点击：始终交给 `handleHashKey()`（进入 / 确认选号），不再播放串流
- 物理键盘：`0-9 * #` 映射为对应屏幕按键；在 input/select/textarea 内不触发

## 网络串流键位与编号

- `STREAM_KEYS = ['3','4','5','6','7','8','9','0']` 只表示九宫格实体键，负责 `refreshChannels()` / `refreshStreamKeys()` 的小字与点击
- `parseStreamKey(raw)` 统一校验：实体键原样返回；数字编号只接受 `3`–`9999`，归一化前导 0；`1` / `2` / `#` / `*` / 5 位以上返回 `null`
- 存储上限 `MAX_STREAMS = 1000`：`loadStreams()` 逐条过滤并截断；设置面板保存前也校验容量
- 编号 > 9 没有实体键，播放入口只有 `#` 选号：`confirmDial()` 先查 `state.streams[String(N)]`，命中即 `playStream()`，未命中才按曲目序号点歌
- `hasNumericStreams()` 用于允许「曲库不足 3 首但已绑定编号串流」的用户进入选号态；`dialHintText()` 组合提示文案
- 排序统一用 `sortStreamKeys()`：数字编号升序，然后 `0`（`*` 已不再作为串流键）

## 按序号点歌（`#` → 数字 → `#`）

- 状态机：`startDial()` 置 `active`、清 `buf`、`renderDial()` 并在 `#` 键上加 `.dialing`；`dialDigit(d)` 追加数字并重置 5 秒计时；`confirmDial()` 优先查串流编号，否则 `jumpToTrack(n)`；`cancelDial()` 清空并 `renderDash()`
- 序号：1 起算、按 `state.tracks` 顺序，`N = state.tracks[N-1]`；有效范围 `3 ≤ N ≤ tracks.length`（`1` 随机 / `2` 红心保留）
- 输入限制：`MAX_DIAL_DIGITS = 4`，首位不能为 `0`
- 显示：选号期间复用 `#dash-ch` 显示 `#` + `buf`；退出时 `renderDash()` 按 `mode` 恢复频道数字或串流键位
- 取消：再按 `#` 确认、`*`、播放 / 切歌键，或 `DIAL_TIMEOUT` 超时
- 跳转：目标曲目无 `file`（授权失效）时先 `ensurePlayable()` 重新扫描，再按 `fileName/name` 找回目标播放
- 常驻计数：`#lib-count` 在 `refreshChannels()` 中刷新「已导入 N 首 · 选号 3–N」

## 网页跳转（`*` → 数字 → `*`）

- 状态机 `web = { active, buf, timer }`：`startWebJump()` 置 `active`、清 `buf`、`renderWeb()` 并在 `*` 键加 `.webjump`；`webDigit(d)` 追加编号并重置 5 秒计时；`confirmWebJump()` 查 `state.webLinks[num]` 后 `window.open(url, '_blank', 'noopener,noreferrer')`；`cancelWebJump()` 清空并 `renderDash()`
- 编号：`0`–`999999`，最多 `MAX_WEB_DIGITS = 6` 位；单独 `0` 合法，多位数会自动替换前导 0（不会产生 `01`）
- 显示：`renderWeb()` 把 `#dash-ch` 显示为 `↗` / `↗编号`，并给 `#dashboard` 加 `.dash-link`（脉冲动画）；确认后 `flashDashLabel()` 用 `.dash-link-flash` 闪一下再 `renderDash()`
- 取消 / 互斥：`*` 在选号态优先取消选号；`startWebJump()` 会 `cancelDial(true)`，`startDial()` 会 `cancelWebJump(true)`；播放 / 切歌键、彩蛋触发、5 秒超时也会退出
- 持久化：`loadWebLinks()` / `saveWebLinks()` 使用 `fm_webjumps`；首次无数据时用 `DEFAULT_WEB_LINKS`（`1`→streamurl.link、`2`→roamdial.com、`3`→globalradio.app）
- 设置面板：`webDraft` 临时副本，点「完成」才 `state.webLinks = webDraft; saveWebLinks()`；`nextFreeWebKey()` 从 `0` 起分配空号

## 隐藏彩蛋（数字键连击）

- 常量：`EGG_CODES = ['19930214', '930214']`、`EGG_URL`、`EGG_TIMEOUT = 4000`
- 模块级 `eggBuf` / `eggTimer`；`recordEggDigit(d)` 在数字键点击时先记录（`1`–`9` 与 `0` 都参与），只保留最近 8 位
- 匹配方式为后缀匹配，因此 `19930214` 末尾的 `930214` 也成立；命中后清空缓冲，避免重复触发
- 命中时 `recordEggDigit` 返回 `true`，两个点击处理器立即 `return`，避免后续频道 / 选号 / 串流逻辑覆盖 LED 提示
- `openEasterEgg()` 先 `cancelDial(true)`，再 `window.open('https://create.myfami.cn/', '_blank', 'noopener,noreferrer')`；在用户点击手势内同步调用，避免被弹窗拦截

## 主题系统

- CSS 变量在 `:root` 定义；整页主题通过 `html.skin-crt / skin-cream / skin-tube` 覆盖
- 卡片风格通过 `#dashboard.theme-dark|led|crt|cream|tube`
- `state.cardStyle` 单字段承载 5 个值（复用原 `dark/led` 字段，兼容旧配置）
- `applyTheme(resetAccent)`：切 skin class → 切 dashboard class → 设置 accent → 更新 `<meta name="theme-color">`
- 语义变量：`--panel / --panel-ink / --panel-line / --surface / --hover-bg`，保证深色主题下设置弹层与按键可读
- **坑**：dashboard 必须用 `classList.add/remove`，不能用 `className=`，否则会清掉 `rebooting` 瞬时类

## 设置面板模式

- 每次点击齿轮动态创建 `.sheet-mask`，`innerHTML` 模板 + 事件绑定
- 主题/强调色为**实时预览**，关闭时若未点「完成」则回滚
- 网络串流用**临时副本 `draft`**：增删只改副本，点「完成」才 `state.streams = draft; saveStreams()`；按键 / 编号用文本框输入（`parseStreamKey` 校验，留空自动分配 `nextFreeStreamKey()`）
- 网页跳转用**临时副本 `webDraft`**：增删只改副本，点「完成」才 `state.webLinks = webDraft; saveWebLinks()`；编号 / 网址用文本框输入（`parseWebKey` 校验，留空自动分配 `nextFreeWebKey()`）
- 标题右侧 `#s-stream-cap` 显示 `N / 1000`，达到上限后「＋ 添加」禁用
- 网页跳转区块与串流区块结构一致，标题右侧 `#s-web-cap` 显示网页跳转用量
- 点遮罩 = 取消（主题回滚，串流改动全部丢弃）
- 删除正在播放的串流：点「完成」后停止播放、清 `mode` 并回到 CH1

## 音频底噪

- 单个 `noiseGain` 混合两层：Web Audio 实时粉红噪声 + `waves-Ds5uwdFe.mp3`（MediaElementSource）
- 首次交互 `pointerdown`/`keydown` 解锁 AudioContext
- 淡入 300ms / 淡出 250ms，音量变化 120ms 线性斜坡
- 底噪与音乐音量完全独立，分别由两个竖推子控制

## 整点报时

- 触发链：`updateClock()`（每秒）→ `maybeChime(now)`；条件 `state.playing && !chiming && 分===0 && 秒<=2`，`lastChimedKey` 做小时级去重
- 哔声：`playChimeBeeps(count, done)` 复用 `ensureNoiseCtx()`，用 `OscillatorNode`（880Hz、140ms、间隔 260ms）逐声调度，`count = chimeHour12(hour)`（0/12 点 = 12）
- 文案：`chimePeriod()` + 中文数字 `CN_HOURS`（2 读「两」）→ `现在是${地点}时间${时段}${小时}点整`
- 地点：`resolveLocation(timeZone)`；中国时区列表 → 北京；`CITY_NAMES` 常见城市中译；其余取时区城市段
- TTS：`speakChime()` 用 `speechSynthesis.speak()`，`onend` / `onerror` / 6 秒兜底 → `finishChime()`
- 暂停/恢复：`runChime()` 先 `audio.pause()` 并记录 `chimeResume`；`finishChime()` 仅当 `state.playing` 仍为真才 `audio.play()`
- **坑**：`chiming` / `lastChimedKey` / `chimeResume` 必须在 `updateClock()` 首次同步调用前初始化，否则 TDZ 报错

## 播放记录与导出

- 写入：`recordPlay(t)` 在 `playTrack()` 内调用，push `{ name: t.name, fileName: t.fileName, path: t.path || '', ts: Date.now() }`；`state.history` 截断到 `MAX_HISTORY = 2000`
- 持久化：`loadHistory()` 过滤无 `ts` / 无 `fileName` 的脏数据；`saveHistory()` 包 try/catch
- 区间：`presetRange(preset, now = new Date())` → `today`（本地零点 ~ now）、`yesterday`（前一天零点 ~ 今天零点）、`week`（now - 7d ~ now）
- 转换：`toLocalInputValue(ts)` 输出 `YYYY-MM-DDTHH:mm`（本地时间，补零）；`parseLocalInputValue(v)` 用 `new Date(v).getTime()`，空值返回 `NaN`
- 生成：`buildM3u(list)` 每行 `path || fileName || name`，跳过空条目，首行 `#EXTM3U`
- 导出：`exportHistory(start, end)` 过滤 + 按 `ts` 升序 → `downloadBlob(text, name, 'audio/x-mpegurl')`；返回条数，0 条时不下载
- UI：设置面板导出区块的结束时间需要 `+59999ms`（`datetime-local` 只到分钟），否则当前分钟内的记录会被漏掉
- 文件名：`fm-YYYYMMDD-HHMMSS.m3u`

## 录制

- 判定：`canRecordUrl(url)` 同源返回 true；跨域 `fetch(url, { mode: 'cors' })` 成功为 true（缓存于 `recUrlCache`，值为 Promise）
- 按钮：`refreshRecordButton()` 在 `playTrack()` / `playStream()` / 暂停 / 删除串流后调用；未播放或不可录时 `disabled = true` 并设置 `title`
- 录音图：`startRecording()` → `ensureNoiseCtx()` → 独立 `new Audio()`（跨域设 `crossOrigin='anonymous'`）→ `createMediaElementSource` → `createMediaStreamDestination` → `new MediaRecorder(stream, { mimeType })`
- **不要**把主 `audio` 接入 `createMediaElementSource`：一旦跨域就会永久静音；独立元素失败也不影响主播放
- 停止：`stopRecording(save)` → `recorder.stop()` → `onstop` → `finalizeRecording()` 合并 chunks → `downloadBlob`
- 清理：`cleanupRecording()` 暂停录音元素、清 `src`、断开节点、`recorder = null`；迟到的 `error` 事件用 `if (!recorder) return` 忽略
- 切歌 / 切流：`playTrack()` / `playStream()` 开头 `if (isRecording()) stopRecording(true)`
- 格式：`audio/webm;codecs=opus` → `audio/webm` → `audio/ogg;codecs=opus` → `audio/mp4`，文件名扩展名随之变化（`fm-rec-*.webm|ogg|m4a`）

## 代码约定

- 使用 `$` 选择器简写、模板字符串、函数声明（有提升，便于 init 前调用）
- 用户可见文案为中文，日志为中文
- 所有持久化写入都包 try/catch（localStorage 可能被禁用）
- 新增 UI 文案需同步更新 `README.md`
