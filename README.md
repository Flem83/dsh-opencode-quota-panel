# OpenCode 额度（dsh-opencode-quota-panel）

[![npm version](https://img.shields.io/npm/v/dsh-opencode-quota-panel.svg)](https://www.npmjs.com/package/dsh-opencode-quota-panel)
[![license](https://img.shields.io/npm/l/dsh-opencode-quota-panel.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-plugin-8A2BE2)](https://github.com/Flem83/dsh-opencode-quota-panel)

在 DSH 网页界面里显示 **OpenCode Go 订阅额度**：5 小时滚动窗口、本周、本月三条用量，带重置倒计时、用量预测、明细表，以及模型选择框旁的额度徽章。

## 能力

- **侧边栏条目**「OpenCode 额度」→ 打开额度页（仪表在上、明细在下，内容紧凑、留白只在下方）：
  - **三个环形表盘**：环长 = 剩余额度，环心是剩余百分比；颜色随剩余比例变化（<50% 黄、<20% 红）；
  - 每个环下两行：**重置倒计时** 和 **预计用到 X%**（按整个周期已过时间的平均消耗外推，不做突发速率外推；会超额时数字变红）。环心的「剩余」标注方向，避免把环长误读成已用；
  - **明细表**（视觉中心下方，常驻、不靠悬浮）：每窗口的 **已用 %**、**平均速率**、**精确重置时间**，表下按两行说明速率口径与估算假设（第二行「窗口刚开始时不估算」；本月周期按 30 天估算时追加注明）；窗口刚开始、暂无可靠预测时速率显示 `—`；
  - **徽章开关**：一行「输入框徽章」开关，持久保存。开关在浅色/深色主题下都有可见的轨道与滑块。
- **模型选择框左侧的额度徽章**（`conversation.input.right`）：三段读数 `● 5h 94% │ ● 周 93% │ ● 月 33%`，点一下直接跳到额度页；颜色随剩余比例变化。
  鼠标悬停或键盘聚焦时，弹出一张 portal 到页面 body 的小卡：三个窗口各一枚迷你环（环长 = 剩余额度）、重置倒计时与「预计用到 X%」，取代原先一串文字的浏览器原生提示；按 `Esc`、移出或滚动即关闭。
  **跟随输入框当前会用的模型出现**：会话里取已记录的选择（`next`/`lastUsed`），还没有任何选择的空白会话（首页/新任务）回退到 Host 目录默认模型；两者都不属于 `opencode-go` 时完全隐藏——用别的模型时不会误导成"额度正在被消耗"。
- **侧边栏图标带状态点**：取最紧张窗口的颜色，不打开页面也能看出紧不紧。
- 每 5 分钟自动刷新；标题行右侧的图标按钮点击立即取数（绕过 Host 缓存，并重新积累预测样本）。
- 失败时降级成一行错误条（具体原因 + 刷新按钮），不会白屏；加载中是虚线占位。

## 数据来源与凭证

- 接口：`GET https://opencode.ai/zen/go/v1/usage`（OpenCode Zen 的非公开接口，只读）。
- 凭证：Host 半通过 DSH 凭证服务解析 `OPENCODE_GO_API_KEY`（与 `opencode-go` 模型 provider 用的是同一个 ref），兜底读同名进程环境变量。
- **密钥只在 Host 进程内使用**，不写日志、不进响应体、不下发到浏览器；浏览器只从同源路由 `/opencode-quota/v2/usage` 取归一化后的百分比。
- 插件本身不含任何凭证或订阅数据：页面显示的是当前 Host 上 `OPENCODE_GO_API_KEY` 对应账号的额度。

返回结构（归一化后，每个窗口附带 `forecast`）：

```json
{
  "ok": true,
  "fetchedAt": "2026-11-03T12:42:35.151Z",
  "source": "file",
  "windows": {
    "rolling": {
      "percent": 7,
      "resetsAt": "2026-11-03T14:43:01.000Z",
      "status": "ok",
      "forecast": {
        "ratePerHour": 3.6,
        "ratePerDay": 86.66,
        "projectedPercent": 18.1,
        "willExceed": false,
        "elapsedMs": 15840000,
        "remainingMs": 2030000,
        "assumedSpan": false,
        "reliable": true
      }
    },
    "weekly": {},
    "monthly": {}
  }
}
```

`percent` 是**已用百分比**（0–100），剩余 = 100 − percent。

预测口径：`rate = percent / 已过时间`（整周期均值），`projected = percent + rate × 剩余时间`。不使用近期样本速率——一次连续使用几小时会让短线速率虚高，外推到几天后得出「1 天后耗尽」这类不真实结论。页面上只显示一行「预计用到 X%」，`reliable` 为 false（窗口刚开始）时这一行不出现，详细原因在悬浮提示里；`assumedSpan: true` 表示窗口长度是假设值（本月按 30 天估算），同样只在提示里注明。

## 徽章开关与偏好文件

开关写在 Host 侧，跨浏览器一致、重启不丢：

```
$DSH_HOME/opencode-quota/settings.json
{ "badge": true }
```

读写走同源路由 `GET/POST /opencode-quota/v2/prefs`（POST body `{ "badge": false }`）。删掉这个文件即恢复默认值（开启）。

## 配置（都可选）

在 profile 的 `cordis.patch.yml` 里覆盖该行：

```yaml
- id: opencode-quota
  name: 'dsh-opencode-quota-panel'
  config:
    credentialRef: OPENCODE_GO_API_KEY   # 换别的凭证 ref
    endpoint: /opencode-quota/v2/usage   # Host 只读路由
    prefsEndpoint: /opencode-quota/v2/prefs
    cacheTtlMs: 60000                    # Host 侧缓存；页面手动刷新会绕过
```

## 安装

**从 npm 安装（推荐：插件页能检查更新）**

在 DSH 网页界面打开「插件 → 添加插件」，输入包名：

```
dsh-opencode-quota-panel
```

或在命令行安装：

```powershell
dsh plugin --profile <profile> add dsh-opencode-quota-panel
```

**从 GitHub 安装（不经过 npm）**

```powershell
dsh plugin --profile <profile> add "github:Flem83/dsh-opencode-quota-panel#v1.0.0"
```

**开发时从本地目录安装**

```powershell
dsh plugin --profile desktop add "<本仓库的绝对路径>"
```

安装后刷新 DSH 网页界面（或重启桌面端）即可看到侧边栏条目与输入框上方的徽章。

需要 OpenCode Go 的凭证：在「设置 → 模型」里配置 `OPENCODE_GO_API_KEY`（与 `opencode-go` provider 共用），否则页面会提示未找到凭证。

## 更新

- **npm 安装**：插件页的插件详情里会出现版本列表与「更新」按钮（离开页面再进来或点刷新触发检查）；也可以命令行 `dsh plugin --profile <profile> add dsh-opencode-quota-panel@<新版本>`。
- **GitHub / 本地路径安装**：没有版本检查；卸载后按新 tag / 新路径重新安装。

## 目录

```
index.js            Host 半：取凭证 → 请求 → 缓存 → 预测 → 同源只读路由（用 ctx.effect 注册，可安全重载）
client.js           Client 半：共享 store + 侧边栏条目（带状态点）+ 额度页（三环 + 预测行 + 开关）+ 徽章
cordis.patch.yml    bundle 入口行
locale/{en,zh}.json 插件管理器里显示的标题与描述
icon.svg            仪表盘图标
```

## 已知边界

- `/zen/go/v1/usage` 是 Zen 的内部接口，官方未承诺稳定性；接口变化时页面显示「接口返回了无法识别的数据」，不会崩溃。
- 只发只读 `GET`，不消耗额度、不改订阅状态。
- 预测是**整周期均值**的线性外推：它回答「照这个周期的平均消耗，期末会用到多少」，不预测你接下来几个小时会不会突然猛用；集中使用后的短线速率不参与计算，窗口刚开始（不足 1 分钟或不足周期 2%）时不给预测。
- 早期版本曾把路由注册在 `apply` 返回值之外，Loader 不会收集该返回值，导致旧路由 `/opencode-quota/usage` 无法在重载时卸载；现在改用 `ctx.effect()` 注册并升级到 `/opencode-quota/v2/*`，旧路由会在下一次 DSH 重启后自然消失。
- 未覆盖 OpenCode Zen 预付费余额（需要 console cookie 鉴权，暂未支持）。
