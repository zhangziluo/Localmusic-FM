# 当前上下文（Active Context）

> 最后更新：2026-11-14

## 当前焦点

**已移除 RSS 播客，并新增「按序号点歌」**：`#` 键不再参与网络串流，改为点歌键 —— 按 `#` 进入选号态 → 输入序号 → 再按 `#` 跳到第 N 首。

**网络串流开放编号 > 9**：设置里可填任意编号 `10`–`9999`（共最多 1000 条）；编号没有实体键，通过 `#` 选号播放，且串流优先于同号曲目。

**隐藏彩蛋**：连续点击数字键输入 `19930214` 或 `930214`，会在新窗口打开 `https://create.myfami.cn/`（4 秒内未继续输入则重新计数）。

**整点报时**：播放中每逢整点，先响 12 小时制对应声数的「哔」（Web Audio 合成），再用系统 TTS 播报「现在是北京时间下午一点整」；地点按设备时区推断（离线、不请求 IP），报时期间暂停播放、结束自动继续。

## 当前功能入口

- **按序号点歌 / 选台**：`#` → 数字（可多位）→ `#`；优先匹配串流编号，否则点歌 `3`–曲目总数（`1` 随机 / `2` 红心不可选）
- **设置 → 网络串流 → ＋ 添加**：可绑定实体键 `3`–`9`、`*`、`0`，或编号 `3`–`9999`（实际开放 `10`+，最多 1000 条；`#` 不可绑定）
- 编号 > 9 没有实体键，只能通过 `#` 选号触发；实体键仍直接点击播放
- 直接按 `1` 随机 / `2` 红心；`3`–`9` 在曲库超过 15 首后解锁
- 绑定串流的键直接播放对应流，不再切换频道
- 曲目信息下方常驻「已导入 N 首 · 选号 3–N」

## 本次改动涉及的文件

| 文件 | 改动要点 |
| --- | --- |
| `app.js` | 串流键开放编号 > 9：`parseStreamKey()` / `isNumericStreamKey()` / `sortStreamKeys()`、`MAX_STREAMS = 1000`、`MAX_STREAM_NUM = 9999`；`loadStreams()` 任意键 + 上限；`confirmDial()` 串流优先；设置面板按键下拉改为文本输入 + 容量显示；`dialHintText()` / `hasNumericStreams()`；数字连击彩蛋；整点报时（`maybeChime` / `playChimeBeeps` / `speakChime` / `resolveLocation` / `buildChimeText`） |
| `style.css` | 新增 `.lib-count`、`.key.dialing` 呼吸动画、`.stream-cap` 容量提示；`.stream-key` 增加横向内边距以容纳 4 位编号 |
| `index.html` | 新增 `#lib-count`；`#` 键 aria-label 改为点歌；`style.css?v=9`、`app.js?v=10` |
| `sw.js` | `fm-pwa-v18` + ASSETS 版本同步 |
| `README.md` | 按序号点歌 / 选台、串流编号 10–9999、1000 条上限、版本号同步 |
| `memory-bank/` | 同步本次改动 |

## 关键行为约定（改动时别破坏）

1. `STREAM_KEYS = ['3','4','5','6','7','8','9','*','0']` 是**实体键**；`1`、`2` 永远不可绑定，`#` 专用于点歌 / 选台
2. 串流编号额外支持 `3`–`9999`（`parseStreamKey` 归一化前导 0），最多 `MAX_STREAMS = 1000` 条；编号 > 9 只能通过 `#` 选号触发
3. 选号态由模块级 `dial = { active, buf, timer }` 维护；`DIAL_TIMEOUT = 5000`、`MAX_DIAL_DIGITS = 4`
4. 点击优先级：`#` → 选号逻辑；选号态下数字键 / `0` → 数字位、`*` → 取消；否则再走串流 / 频道逻辑
5. 确认选号：先查 `state.streams[String(N)]` 播流，未命中再校验点歌范围 `3 ≤ N ≤ tracks.length`
6. 只有串流编号、曲目不足 3 首时仍可进入选号态（`hasNumericStreams()`）
7. `state.mode` 两态：`'local' | 'stream'`；`playTrack` 会重置 `mode` / `streamKey`
8. 设置面板串流用 `draft` 副本，点「完成」才提交；遮罩取消丢弃；容量上限 1000，重复 / 非法编号在前端拒绝
9. 删除正在播放的流 → 点完成后 `audio.pause()` 并回到 CH1
10. 主题类挂在 `<html>`；dashboard 用 `classList` 改 `theme-*`，不要用 `className=`
11. 整点报时只在 `state.playing` 为真时触发；`updateClock()` 每秒调用 `maybeChime()`，`分=0 且 秒≤2` 才算整点，`lastChimedKey` 去重、`chiming` 防重入
12. 报时前 `audio.pause()` 并记录 `chimeResume`，哔声 + TTS 结束后仅在 `state.playing` 仍为真时恢复；报时变量必须在 `updateClock` 首次调用前初始化（TDZ）

## 验证方式

```bash
node --check app.js && node --check sw.js
cd /tmp/fmtest && node test.js && node test-restore.js && node test-dial.js && node test-egg.js && node test-streams.js && node test-chime.js
```

若 `/tmp/fmtest` 已不存在（临时目录可能被清理），需要重建 jsdom 脚本：
- `FakeAudio`（记录 src/volume、触发 play/pause/ended）
- `FakeAudioContext`（createGain/createBuffer/createBufferSource/createMediaElementSource）
- 注入 `window.eval(app + ';window.__state=state;window.__dial=dial;')` 后断言 DOM 与 localStorage
- `test-dial.js` 覆盖：进入/确认、`1`/越界拒绝、含 0 多位序号、`*`/传输键/5 秒超时取消、频道与串流不受影响
- `test-egg.js` 桩掉 `window.open`，覆盖 `19930214` / `930214` 触发、不完整与普通数字不触发、选号态触发后退出
- `test-streams.js` 覆盖 `parseStreamKey` 校验、`loadStreams` 1000 条上限、设置面板添加 `123`、重复 / 非法编号拒绝、`#10#` / `#99#` 播流、串流优先、未绑定回退点歌、删除后回 CH1
- `test-chime.js` 覆盖地点推断、12 小时制哔声次数、中文文案、未播放 / 非整点不触发、暂停与恢复、同一整点去重、非中国时区地点。需桩 `AudioContext.createOscillator`、`speechSynthesis`、`Intl.DateTimeFormat`

## 待用户确认

- 目标平台是否包含 **iOS Safari**？（`HTMLMediaElement.volume` 在 iOS 只读，音乐推子需改 GainNode）

## 下一步（按优先级）

1. 浏览器手测编号选台（`#10#`、超过曲目数的编号、最多 1000 条的列表滚动）
2. 浏览器手测按序号点歌（含授权失效后恢复再跳转）
3. 浏览器手测整点报时（哔声次数、TTS 文案、暂停/恢复、后台标签页延迟）
4. 提交本轮改动（移除播客 + 点歌 + 彩蛋 + 串流编号 + 整点报时；`memory-bank/` 仍未跟踪）
5. 视需要补 `.gitignore`（`.venv/`、`.DS_Store`、`*.bak`）

## 快速排查

| 现象 | 排查点 |
| --- | --- |
| 改了代码浏览器没变 | `sw.js` 的 `CACHE` 是否 bump；`index.html` 查询串是否 bump；DevTools 里 Unregister SW |
| 按键不显示流名 | `refreshChannels()` / `refreshStreamKeys()` 是否在保存后调用 |
| 串流没声音 | URL 是否 https、格式是否浏览器支持、Console 是否有 `error`/CORS 报错 |
| `#` 键没进入选号 | 曲库是否 ≥ 3 首，或是否已绑定编号 > 9 的串流；`#` 的点击是否被 `handleHashKey()` 接管 |
| 编号选台没反应 | 设置里编号是否被 `parseStreamKey()` 接受（3–9999，不能是 1/2）；保存后是否点「完成」；是否超出 1000 条上限 |
| 点歌跳到错误的歌 | 序号按导入顺序计算，重新导入 / 恢复后顺序可能变化 |
| 整点没有报时 | 是否正在播放；标签页是否被后台节流；`updateClock` 是否每秒运行；`lastChimedKey` 是否已记录该小时 |
| 报时后没有继续播放 | 浏览器是否拒绝了非手势 `audio.play()`；控制台是否有 `NotAllowedError` |
| 设置弹层被截断 | `.sheet` 的 `max-height: 88vh; overflow-y: auto` 是否被覆盖 |

