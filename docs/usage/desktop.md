# Beecode Desktop 使用文档

## 1. 当前范围

Desktop 当前完成第四阶段 Slice 4 的只读 Workspace 子切片：

- 系统浏览器 OAuth 登录，使用独立的 `desktop` surface。
- 创建和切换 Desktop Session。
- 本地 Runtime Sidecar 执行 Agent Loop、`calculator` 和 `read_file` 工具。
- 通过系统目录选择器添加、更换或移除本机 Workspace。
- 显示 Tool Call、Tool Result 和最终回答。
- 取消活动 Turn、刷新 Access Token、Runtime 崩溃重启和 Session 快照恢复。

当前已在 macOS Apple Silicon 上完成 calculator 基线的打包与 Electron E2E 验证。只读 Workspace 已实现；文件写入、Shell、Git、Approval、托盘、自动更新、正式签名/公证以及 Windows/Linux 发布验收仍属于后续 Slice 4/5。

## 2. 环境要求

- Node.js 20 或更高版本。
- pnpm 10 或更高版本。
- 可用的系统浏览器。

首次使用先在仓库根目录安装依赖：

```bash
corepack enable
pnpm install --frozen-lockfile
```

## 3. 开发模式启动

首次登录依赖 Web 的开发登录页，因此 Backend、Web 和 Desktop 三个进程都要运行。

在第一个终端启动 Backend：

```bash
pnpm backend
```

默认监听 `http://127.0.0.1:8787`，使用 Fake Provider，不访问外部模型，也不会产生模型费用。

在第二个终端启动 Web 登录页：

```bash
pnpm web
```

默认监听 `http://127.0.0.1:5173`。

在第三个终端启动 Desktop：

```bash
pnpm --filter @beecode/desktop start
```

Desktop 默认连接 `http://127.0.0.1:8787`。启动后左下角应显示“Runtime 可用”。

## 4. 完成首条 Agent 闭环

1. 在 Desktop 点击“登录”。
2. 系统浏览器打开后，点击“使用开发账号登录”。
3. 在 Beecode Desktop 授权页点击“授权”，浏览器会通过 `ai.beecode.desktop://oauth/callback` 返回 App。
4. 点击左上角的“新建会话”按钮。
5. 输入 `计算 1+1`，按 `Enter` 或点击发送按钮。
6. 确认界面依次显示 calculator Tool Call、Tool Result `2` 和最终回答。

活动 Turn 执行期间可以点击“取消”。退出并重新启动 App 后，同一账号的 Desktop Session 会从 Backend 快照恢复。Web、CLI、iOS 与 Desktop 共用账号和额度，但 Session 按 surface 隔离，不会互相出现在列表中。

## 5. 使用本机 Workspace

1. 登录并等待左下角显示“Runtime 可用”。
2. 点击会话顶栏的文件夹加号按钮，使用系统目录选择器授权一个目录。
3. 顶栏只显示目录名称和文件数，不显示绝对路径。
4. 让模型列出工作空间文件，或读取类似 `README.md`、`src/index.ts` 的相对路径。
5. 使用更换按钮重新选择目录，或点击当前 Workspace 旁的移除按钮撤销授权。

`read_file` 不传 `path` 时最多返回前 100 个文件，传入相对路径时只读取 UTF-8 文本。绝对路径、`..`、二进制、超大文件和指向 Workspace 外部的符号链接会被 Runtime 拒绝。未选择 Workspace 时工具不会进入模型 Schema；活动 Turn 执行期间不能更换或移除 Workspace。

## 6. 运行打包后的 App

从仓库根目录生成当前平台的未安装 App：

```bash
pnpm --filter @beecode/desktop build
```

macOS Apple Silicon 的输出位置为：

```text
apps/desktop/out/Beecode-darwin-arm64/Beecode.app
```

先保持 Backend 和 Web 运行，再启动 App：

```bash
open apps/desktop/out/Beecode-darwin-arm64/Beecode.app
```

`build` 生成的是本地验证用的 unpacked App。当前 macOS 包使用 ad-hoc 签名，尚未做 Developer ID 签名和公证；它不是面向用户分发的正式安装包。`make` 可以生成开发 ZIP，但正式发布、安装、签名、公证和多平台验收要到 Slice 5 完成。

## 7. 配置

### Desktop 配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `BEECODE_BACKEND_URL` | `http://127.0.0.1:8787` | Desktop Main 和 Runtime Sidecar 访问的 Backend URL |

开发模式连接其他 Backend：

```bash
BEECODE_BACKEND_URL=http://127.0.0.1:9000 \
pnpm --filter @beecode/desktop start
```

macOS 打包 App 从 Finder 启动时不会继承当前 Shell 的环境变量。需要连接非默认 Backend 时，从终端启动包内可执行文件：

```bash
BEECODE_BACKEND_URL=http://127.0.0.1:9000 \
apps/desktop/out/Beecode-darwin-arm64/Beecode.app/Contents/MacOS/beecode
```

### OAuth 配置

Desktop OAuth client 固定为 `beecode-desktop`，回调固定为：

```text
ai.beecode.desktop://oauth/callback
```

Backend 的 `BEECODE_DESKTOP_OAUTH_REDIRECT_URI` 默认也是这个值。当前客户端会严格校验 scheme、host、path、query 和 fragment；本地使用时不要把 Backend 的值改成其他 URI，否则授权会被拒绝。

真实模型 Provider 只配置在 Backend，Desktop 不保存供应商密钥。配置 Anthropic 或 OpenAI 兼容 Provider 的方式见 [CLI 使用文档](./cli.md#5-使用真实模型-provider)。

## 8. 常见问题

### 点击“登录”后打不开登录页

确认 Backend 和 Web 都在运行，并分别检查：

```text
http://127.0.0.1:8787/openapi.json
http://127.0.0.1:5173/login
```

Desktop 首次授权会从 Backend 跳转到 Web 登录页，只启动 Backend 不足以完成本地开发登录。

### 浏览器授权后没有返回 App

1. 确认只运行一个 Beecode Desktop 实例。
2. 确认 Backend 没有覆盖成其他 `BEECODE_DESKTOP_OAUTH_REDIRECT_URI`。
3. 退出 Desktop 后重新启动，再发起一次登录；OAuth `state` 和授权码都是单次使用的。
4. 开发模式回调不稳定时，先执行 `build`，再使用打包后的 App 验证系统 URL Scheme 注册。

### 显示“Runtime 不可用”

先确认 Backend 可访问，再点击界面中的“重试 Runtime”。如果 Backend 地址不是默认值，确认 Desktop Main 启动时已设置同一个 `BEECODE_BACKEND_URL`。

### 登录重启后没有保留

凭据由 Electron Main 使用操作系统安全存储保存。安全存储不可用时，登录页会提示“本次登录不会持久化”，关闭 App 后需要重新登录；Renderer 和 Runtime Sidecar 都不会直接读取 Refresh Token。

### `read_file` 不可用

确认已选择 Workspace，且没有活动 Turn。Workspace 只绑定当前 Runtime，App 或 Runtime 重启后需要重新选择；它不会随 Session 同步到 Backend 或其他设备。

## 9. 开发验证

```bash
pnpm --filter @beecode/desktop typecheck
pnpm --filter @beecode/desktop test
pnpm --filter @beecode/desktop build
pnpm --filter @beecode/desktop test:e2e
```

当前自动化覆盖 OAuth、calculator、只读 Workspace、`read_file`、取消、Runtime 崩溃恢复和 Access Token 刷新。Desktop 或共享协议、Backend 行为有变更时，再运行仓库级检查：

```bash
pnpm check
```
