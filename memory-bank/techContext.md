# 技术上下文（Tech Context）

## 技术栈

- 原生 HTML / CSS / JavaScript（ES2020 语法，无框架、无打包）
- Web Audio API（底噪合成与混音、整点报时哔声、录音图）
- MediaRecorder API（录制本地曲目 / 网络串流，输出 webm / ogg / mp4）
- SpeechSynthesis API（整点报时系统 TTS，部分系统需自带中文语音）
- File System Access API（文件夹导入 / 句柄持久化，Chromium 系）
- IndexedDB（保存文件夹句柄）
- Service Worker（离线缓存，stale-while-revalidate）
- PWA Manifest（standalone + 图标）

## 目录结构

```text
fmradio/
├── index.html          # 页面结构（状态条 / 数据卡片 / 双推子 + 录制按钮 / 控制栏 / 九宫格 / 设置挂载点）
├── style.css           # 全部样式（主题变量、卡片、双推子、录制按钮、键盘、设置弹层、串流 / 网页跳转 / 导出 UI）
├── app.js              # 全部逻辑（单文件，约 2000 行）
├── sw.js               # Service Worker（缓存 fm-pwa-v20）
├── manifest.json       # PWA 清单
├── waves-Ds5uwdFe.mp3  # 海浪底噪音频（约 20MB，不参与 install 预缓存）
├── icon-192.png / icon-512.png
├── fonts/
│   ├── DSEG14Classic-Regular.woff2
│   ├── DSEG14Classic-Bold.woff2
│   └── OFL.txt
├── README.md           # 用户文档（功能 / 使用 / 限制 / 兼容性）
└── memory-bank/        # 本目录：项目记忆
```

## 运行与验证

```bash
# 启动
python3 -m http.server 8000      # 或 npx serve .

# 语法检查（无正式测试框架）
node --check app.js
node --check sw.js
```

- 临时 jsdom 回归脚本位于仓库外：`/tmp/fmtest/test.js`、`test-restore.js`、`test-dial.js`、`test-egg.js`、`test-streams.js`、`test-chime.js`、`test-history.js`、`test-record.js`、`test-webjump.js`
  （FakeAudio / FakeAudioContext / FakeSpeechSynthesis / FakeMediaRecorder 注入；`test-podcast.js` 已废弃）
- 不要用 `file://` 打开：SW 与文件夹句柄持久化都需要安全上下文

## 当前资源版本

| 资源 | 版本 |
| --- | --- |
| `style.css` | `?v=11` |
| `app.js` | `?v=12` |
| SW 缓存名 | `fm-pwa-v20` |

改静态资源后必须同步：`index.html` 查询串 + `sw.js` 的 `CACHE` 与 `ASSETS`，否则旧客户端可能继续用缓存。

## 本地存储

| 位置 | 键 | 内容 |
| --- | --- | --- |
| localStorage | `fm_config` | totalPlayTime / noiseOn / noiseVolume / musicVolume / voiceInterval / accent / cardStyle |
| localStorage | `fm_favs` | 收藏曲名数组（兼容文件名与去扩展名曲名） |
| localStorage | `fm_library` | 曲库索引（name / fileName / path） |
| localStorage | `fm_streams` | 网络串流表 `{ 键: { name, url } }`，键 ∈ `3-9 0` 或编号 `10-9999`（`#` 用于选号、`*` 用于网页跳转，均不参与串流），最多 1000 条 |
| localStorage | `fm_webjumps` | 网页跳转表 `{ 编号: url }`，编号 ∈ `0-999999`（前导 0 归一化），最多 1000 条；内置 22 条默认 |
| localStorage | `fm_webjumps_seed` | 已套用的内置默认版本号（`WEB_SEED_VERSION`），用于一次性补全缺失的内置编号 |
| localStorage | `fm_history` | 本地曲目播放记录 `[{ name, fileName, path, ts }]`，最多 2000 条，用于导出 `.m3u` |
| IndexedDB | `fm-pwa-db` / `handles` / `music-dir` | 上次选择的音乐文件夹句柄 |

## 外部依赖（运行时）

无第三方运行时依赖。网络串流由 `<audio>` 直接播放远程地址，不经过任何代理服务；整点报时的地点判定只用设备 `Intl` 时区，不请求 IP 接口。

## 环境与约束

- 开发机：macOS（darwin），Node v24 可用
- Python3 可用于起静态服务器
- 无 `package.json`、无 `node_modules`（仓库外临时测试目录才有 jsdom）
- 版本库中已意外纳入 `.DS_Store`、`index.html.bak`、`waves-Ds5uwdFe.mp3`；`.venv/` 为空目录（Git 不跟踪空目录）
- 建议后续清理：添加 `.gitignore` 并 `git rm --cached .DS_Store index.html.bak`
