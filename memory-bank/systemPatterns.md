# 系统模式（System Patterns）

## 总体架构

单页 + 单脚本，无模块系统。`app.js` 按区块顺序组织，全部依赖挂在一个全局 `state` 对象上，选号态另有模块级 `dial`：

```
IndexedDB helpers → 常量（STREAM_KEYS）→ state + dial
→ 主题 → init(IIFE) → 时钟/时长 → 音频/底噪 → 曲库播放 → 推子 → 控制栏 → 导入/恢复
→ 频道+网络串流 → 按序号点歌 → 设置面板 → 键盘 → SW 注册
```

## 核心状态 `state`

```js
{
  tracks: [], played: [], current: null, playing: false,
  noiseOn, noiseVolume, voiceInterval, musicVolume,
  totalPlayTime, playStartTime, rebooting,
  ch: 1, accent: '#ff8c42', cardStyle: 'dark',
  favorites: Set,
  streams: {},          // '3'-'9' | '*' | '0' → { name, url }（'#' 不可绑定）
  mode: 'local',        // 'local' | 'stream'
  streamKey: null,      // 当前播放流绑定的键位
}
```

选号态单独用模块级对象保存（不进入 `state`，也不持久化）：

```js
const dial = { active: false, buf: '', timer: 0 };
const DIAL_TIMEOUT = 5000;   // 5 秒无操作自动取消
const MAX_DIAL_DIGITS = 4;   // 最多 4 位序号
```

约定：
- `state.ch` 本地频道时是**数字**，播放串流时是**键位字符串**（`'3'`、`'*'`…）
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
- 点击优先级（数字键）：选号态 → `dialDigit()` > 绑定流 → `playStream()` > 频道 / 解锁逻辑
- `*` / `0` 点击：选号态下 `*` 取消、`0` 作为数字位；否则绑定流就播放
- `#` 点击：始终交给 `handleHashKey()`（进入 / 确认选号），不再播放串流
- 物理键盘：`0-9 * #` 映射为对应屏幕按键；在 input/select/textarea 内不触发

## 按序号点歌（`#` → 数字 → `#`）

- 状态机：`startDial()` 置 `active`、清 `buf`、`renderDial()` 并在 `#` 键上加 `.dialing`；`dialDigit(d)` 追加数字并重置 5 秒计时；`confirmDial()` 校验后 `jumpToTrack(n)`；`cancelDial()` 清空并 `renderDash()`
- 序号：1 起算、按 `state.tracks` 顺序，`N = state.tracks[N-1]`；有效范围 `3 ≤ N ≤ tracks.length`（`1` 随机 / `2` 红心保留）
- 输入限制：`MAX_DIAL_DIGITS = 4`，首位不能为 `0`
- 显示：选号期间复用 `#dash-ch` 显示 `#` + `buf`；退出时 `renderDash()` 按 `mode` 恢复频道数字或串流键位
- 取消：再按 `#` 确认、`*`、播放 / 切歌键，或 `DIAL_TIMEOUT` 超时
- 跳转：目标曲目无 `file`（授权失效）时先 `ensurePlayable()` 重新扫描，再按 `fileName/name` 找回目标播放
- 常驻计数：`#lib-count` 在 `refreshChannels()` 中刷新「已导入 N 首 · 选号 3–N」

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
- 网络串流用**临时副本 `draft`**：增删只改副本，点「完成」才 `state.streams = draft; saveStreams()`
- 点遮罩 = 取消（主题回滚，串流改动全部丢弃）
- 删除正在播放的串流：点「完成」后停止播放、清 `mode` 并回到 CH1

## 音频底噪

- 单个 `noiseGain` 混合两层：Web Audio 实时粉红噪声 + `waves-Ds5uwdFe.mp3`（MediaElementSource）
- 首次交互 `pointerdown`/`keydown` 解锁 AudioContext
- 淡入 300ms / 淡出 250ms，音量变化 120ms 线性斜坡
- 底噪与音乐音量完全独立，分别由两个竖推子控制

## 代码约定

- 使用 `$` 选择器简写、模板字符串、函数声明（有提升，便于 init 前调用）
- 用户可见文案为中文，日志为中文
- 所有持久化写入都包 try/catch（localStorage 可能被禁用）
- 新增 UI 文案需同步更新 `README.md`
