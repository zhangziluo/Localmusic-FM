# 当前上下文（Active Context）

> 最后更新：2026-11-14

## 当前焦点

**已移除 RSS 播客，并新增「按序号点歌」**：`#` 键不再参与网络串流，改为点歌键 —— 按 `#` 进入选号态 → 输入序号 → 再按 `#` 跳到第 N 首。

## 当前功能入口

- **按序号点歌**：`#` → 数字（可多位）→ `#`；有效序号 `3`–曲目总数（`1` 随机 / `2` 红心不可选）
- **设置 → 网络串流 → ＋ 添加**：可绑定 `3`–`9`、`*`、`0`（`#` 不可绑定）
- 直接按 `1` 随机 / `2` 红心；`3`–`9` 在曲库超过 15 首后解锁
- 绑定串流的键直接播放对应流，不再切换频道
- 曲目信息下方常驻「已导入 N 首 · 选号 3–N」

## 本次改动涉及的文件

| 文件 | 改动要点 |
| --- | --- |
| `app.js` | `STREAM_KEYS` 去掉 `#`；新增 `dial` 状态机（`startDial/cancelDial/dialDigit/confirmDial/jumpToTrack/handleHashKey/renderDial/renderDash`）；数字键与 `*`/`0`/`#` 点击接入选号；`refreshChannels()` 刷新 `#lib-count`；传输键取消选号 |
| `style.css` | 新增 `.lib-count` 与 `.key.dialing` 呼吸动画 |
| `index.html` | 新增 `#lib-count`；`#` 键 aria-label 改为点歌；`style.css?v=8`、`app.js?v=7` |
| `sw.js` | `fm-pwa-v15` + ASSETS 版本同步 |
| `README.md` | 新增「按序号点歌」章节；网络串流键位去掉 `#`；版本号同步 |
| `memory-bank/` | 同步本次改动 |

## 关键行为约定（改动时别破坏）

1. `STREAM_KEYS = ['3','4','5','6','7','8','9','*','0']` —— **1、2 永远不可绑定，`#` 专用于点歌**
2. 选号态由模块级 `dial = { active, buf, timer }` 维护；`DIAL_TIMEOUT = 5000`、`MAX_DIAL_DIGITS = 4`
3. 点击优先级：`#` → 选号逻辑；选号态下数字键 / `0` → 数字位、`*` → 取消；否则再走串流 / 频道逻辑
4. 序号口径：按 `state.tracks` 顺序、1 起算，`N` 有效范围 `3 ≤ N ≤ tracks.length`
5. `state.mode` 两态：`'local' | 'stream'`；`playTrack` 会重置 `mode` / `streamKey`
6. 设置面板串流用 `draft` 副本，点「完成」才提交；遮罩取消丢弃
7. 删除正在播放的流 → 点完成后 `audio.pause()` 并回到 CH1
8. 主题类挂在 `<html>`；dashboard 用 `classList` 改 `theme-*`，不要用 `className=`

## 验证方式

```bash
node --check app.js && node --check sw.js
cd /tmp/fmtest && node test.js && node test-restore.js && node test-dial.js
```

若 `/tmp/fmtest` 已不存在（临时目录可能被清理），需要重建 jsdom 脚本：
- `FakeAudio`（记录 src/volume、触发 play/pause/ended）
- `FakeAudioContext`（createGain/createBuffer/createBufferSource/createMediaElementSource）
- 注入 `window.eval(app + ';window.__state=state;window.__dial=dial;')` 后断言 DOM 与 localStorage
- `test-dial.js` 覆盖：进入/确认、`1`/越界拒绝、含 0 多位序号、`*`/传输键/5 秒超时取消、频道与串流不受影响

## 待用户确认

- 目标平台是否包含 **iOS Safari**？（`HTMLMediaElement.volume` 在 iOS 只读，音乐推子需改 GainNode）

## 下一步（按优先级）

1. 浏览器手测按序号点歌（含授权失效后恢复再跳转）
2. 提交本轮改动（移除播客 + 点歌功能；`memory-bank/` 仍未跟踪）
3. 视需要补 `.gitignore`（`.venv/`、`.DS_Store`、`*.bak`）

## 快速排查

| 现象 | 排查点 |
| --- | --- |
| 改了代码浏览器没变 | `sw.js` 的 `CACHE` 是否 bump；`index.html` 查询串是否 bump；DevTools 里 Unregister SW |
| 按键不显示流名 | `refreshChannels()` / `refreshStreamKeys()` 是否在保存后调用 |
| 串流没声音 | URL 是否 https、格式是否浏览器支持、Console 是否有 `error`/CORS 报错 |
| `#` 键没进入选号 | 曲库是否 ≥ 3 首；`#` 的点击是否被 `handleHashKey()` 接管 |
| 点歌跳到错误的歌 | 序号按导入顺序计算，重新导入 / 恢复后顺序可能变化 |
| 设置弹层被截断 | `.sheet` 的 `max-height: 88vh; overflow-y: auto` 是否被覆盖 |

