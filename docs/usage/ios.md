# Beecode iOS 启动与调用说明

当前 iOS 客户端已完成第三阶段 Slice 0-Slice 5：原生 SwiftUI、OAuth/PKCE、Keychain 凭据、Bearer API、`surface=ios` Session、Conversation、Turn/取消、Tool Call，以及 SSE 与生命周期恢复。

## 1. 环境要求

- macOS、Xcode 26.0+，并安装至少一个 iOS 17+ Simulator Runtime。
- Node.js 20+、pnpm 10+。
- 在仓库根目录安装依赖：

```bash
pnpm install --frozen-lockfile
```

iOS 的完整登录与 Agent 调用需要同时运行 Backend 和 Web：

- Backend 提供 OAuth、iOS API、SSE 和 Agent Runtime。
- Web 提供 development identity 登录页。App 通过系统浏览器完成登录和授权，不使用嵌入式 WebView。

## 2. 配置访问地址

App 从 `apps/ios/Config/Debug.xcconfig` 的 `BEECODE_API_BASE_URL` 读取 Debug Backend 地址。URL 必须与 Backend 的 `BEECODE_PUBLIC_BASE_URL` 使用同一个、设备可访问的地址。

### 2.1 Simulator 使用本机回环地址

如果 Debug 配置为：

```xcconfig
BEECODE_API_BASE_URL = http:/$()/127.0.0.1:8787
```

分别在两个终端从仓库根目录启动：

```bash
pnpm backend
```

```bash
pnpm web
```

默认地址为：

- Backend：`http://127.0.0.1:8787`
- Web 登录页：`http://127.0.0.1:5173`

### 2.2 当前局域网地址或真机

仓库当前 Debug 配置指向 `http://169.254.177.243:8787`。使用该地址时，Backend 和 Web 不能只监听 loopback。先确认这个地址仍属于开发 Mac：

```bash
ipconfig getifaddr en0
```

如果 Mac 使用其他网卡或地址，请同步修改下面命令中的地址和 `Debug.xcconfig`。然后分别启动 Backend 与 Web：

```bash
BEECODE_BACKEND_HOST=0.0.0.0 \
BEECODE_PUBLIC_BASE_URL=http://169.254.177.243:8787 \
BEECODE_WEB_ORIGIN=http://169.254.177.243:5173 \
BEECODE_DEV_AUTH_ENABLED=true \
BEECODE_DEV_LOGIN_SECRET=local-ios-development \
pnpm backend
```

```bash
pnpm --filter @beecode/web exec vite --host 0.0.0.0
```

Backend 启动日志应包含 `listening on http://0.0.0.0:8787`。在设备浏览器打开以下地址，确认网络可达：

```text
http://169.254.177.243:8787/openapi.json
http://169.254.177.243:5173/login
```

真机和 Mac 必须位于互通网络中，并允许 macOS 防火墙接收入站连接。`169.254.*` 属于链路本地地址，网络环境变化后可能失效；稳定联调优先使用同一 Wi-Fi 下的 Mac 局域网地址。

## 3. 启动 iOS App

### 3.1 使用 Xcode 启动（推荐）

从仓库根目录打开工程：

```bash
open apps/ios/Beecode.xcodeproj
```

在 Xcode 中：

1. 选择共享 Scheme `Beecode`。
2. 选择一个 iOS 17+ Simulator，或已完成签名配置的真机。
3. 按 `Command-R` 构建并启动。

修改 `Debug.xcconfig` 后需重新构建 App；已经安装的旧构建不会自动获得新地址。

### 3.2 使用命令行启动 Simulator

先查看可用设备：

```bash
xcrun simctl list devices available
```

以下以 `iPhone 15 Pro` 为例；如果设备尚未启动，先执行 `boot`：

```bash
xcrun simctl boot "iPhone 15 Pro"
xcrun simctl bootstatus "iPhone 15 Pro" -b
```

构建、安装并启动：

```bash
xcodebuild \
  -project apps/ios/Beecode.xcodeproj \
  -scheme Beecode \
  -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 15 Pro' \
  -derivedDataPath apps/ios/DerivedData \
  CODE_SIGNING_ALLOWED=NO \
  build
```

```bash
xcrun simctl install booted \
  apps/ios/DerivedData/Build/Products/Debug-iphonesimulator/Beecode.app
```

```bash
xcrun simctl launch booted ai.beecode.ios
```

如果 Simulator 已处于 Booted 状态，可以跳过 `simctl boot`。

## 4. 登录并调用 Agent

确保 Backend 与 Web 仍在运行，然后在 App 中执行：

1. 点击“登录 Beecode”。
2. App 打开系统授权浏览器；未登录时会跳转到 Web development identity 登录页。
3. 完成 development identity 登录，在 `beecode-ios` 授权页点击“授权”。
4. 浏览器通过 `ai.beecode.ios://oauth/callback` 返回 App。
5. 新建或打开一个 iOS Session。
6. 在输入框输入 `计算 1+1` 并发送。

默认 Backend 使用可控的 fake model adapter，但 calculator 仍在真实 Backend Agent Runtime 中执行。预期依次看到：

1. Turn 已提交、排队或运行中。
2. `calculator` Tool requested/running/completed。
3. Tool Result 为 `2`。
4. 最终回答为 `1+1 = 2`，并显示 usage。

运行过程中可点击停止按钮取消活动 Turn。切后台或短暂断网不会由 App 自行制造失败终态；返回前台或网络恢复后，App 会重连 SSE、读取权威 Session 快照并恢复结果。

## 5. iOS API 调用顺序

App 只调用 `/v1/ios/*`，不能使用 Web Cookie、CLI Token 或 `/v1/web/*` 代替。主要请求顺序为：

| 操作 | 请求 |
| --- | --- |
| 列出 Session | `GET /v1/ios/sessions` |
| 创建 Session | `POST /v1/ios/sessions` |
| 读取权威快照 | `GET /v1/ios/sessions/{sessionId}` |
| 建立实时事件流 | `GET /v1/ios/sessions/{sessionId}/events` |
| 幂等提交 Turn | `POST /v1/ios/sessions/{sessionId}/turns` |
| 取消活动 Turn | `POST /v1/ios/sessions/{sessionId}/turns/{turnId}/cancel` |

普通 JSON 与 SSE 请求都携带由 `beecode-ios` OAuth Authorization Code + PKCE 流程取得的 Bearer Access Token。Refresh Token 只保存在 Keychain，Access Token 不写入配置、日志或普通文件。直接调试 API 时也必须使用 `beecode-ios` Token；`/v1/auth/dev-token` 返回的 development/CLI Token 会被 iOS 路由拒绝。

## 6. 无 Backend 的 UI Fixture

仅检查页面和交互时，可以运行 UI 自动化；它通过 `--ui-testing-signed-in` 跳过真实登录，并使用确定性的 calculator fixture，不证明真实网络或 Backend 可用：

```bash
xcodebuild \
  -project apps/ios/Beecode.xcodeproj \
  -scheme Beecode \
  -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 15 Pro' \
  -derivedDataPath apps/ios/DerivedData \
  CODE_SIGNING_ALLOWED=NO \
  -only-testing:BeecodeUITests \
  test
```

已安装 Debug App 时也可以手工启动 fixture 模式：

```bash
xcrun simctl launch --terminate-running-process \
  booted ai.beecode.ios --ui-testing-signed-in
```

## 7. 真机启动

真机除第 2.2 节的局域网 Backend/Web 配置外，还需要：

1. 在 Xcode 中为 App 和测试 target 配置 Apple Developer Team。
2. 将 `ai.beecode.ios` 替换为已注册的正式 Bundle ID，或为当前开发 Bundle ID 配置签名。
3. 保持 App 与 Backend 的 OAuth redirect URI 都为 `ai.beecode.ios://oauth/callback`；scheme、host、path 任一部分不一致都会导致授权码交换失败。
4. 首次启动时允许本地网络访问。
5. Release 环境必须使用 HTTPS；Debug 的本地网络 ATS 例外不能带入 Release。

命令行构建示例：

```bash
xcodebuild \
  -project apps/ios/Beecode.xcodeproj \
  -scheme Beecode \
  -configuration Debug \
  -destination 'platform=iOS,id=<device-udid>' \
  -derivedDataPath apps/ios/DerivedData \
  build
```

构建后通常由 Xcode 的 `Command-R` 安装和启动真机 App。自动化默认使用可控 Provider；宣称真实模型链路通过前，仍需配置真实 Model Gateway 并运行 provider Smoke Test。

## 8. 测试与验证

无签名 Simulator SDK 构建：

```bash
xcodebuild \
  -project apps/ios/Beecode.xcodeproj \
  -scheme Beecode \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath apps/ios/DerivedData \
  CODE_SIGNING_ALLOWED=NO \
  build
```

运行 Swift Testing 与 XCUITest：

```bash
xcodebuild \
  -project apps/ios/Beecode.xcodeproj \
  -scheme Beecode \
  -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 15 Pro' \
  -derivedDataPath apps/ios/DerivedData \
  CODE_SIGNING_ALLOWED=NO \
  test
```

Backend 与协议验证：

```bash
pnpm --filter @beecode/backend typecheck
pnpm --filter @beecode/backend test
pnpm --filter @beecode/protocol typecheck
pnpm --filter @beecode/protocol test
```

## 9. 常见问题

### 9.1 打开 Session 后一直显示“正在加载会话”

正常打开会话时，Backend 日志应先出现 SSE，再出现权威快照请求：

```text
GET /v1/ios/sessions/{sessionId}/events 200
GET /v1/ios/sessions/{sessionId} 200
```

`/events` 的 `200` 只表示 SSE 长连接建立；App 收到首个 `stream.connected` 事件后才会请求第二个快照接口。如果只有 `/events` 而没有快照请求：

1. 重新构建并安装最新 Debug App，避免运行修复前使用 `AsyncBytes.lines` 丢失 SSE 空分隔行的旧版本。
2. 确认 App、Backend 的 base URL 一致，且没有代理缓存或合并 `text/event-stream`。
3. 确认 Backend 响应包含 `Content-Type: text/event-stream`、`Cache-Control: no-cache, no-transform` 和 `X-Accel-Buffering: no`。
4. 终止旧 App 后重新启动；必要时删除 App，清理旧 Debug 构建和 Keychain 测试凭据后重新登录。

### 9.2 `/events` 重复出现

短暂断网、App 前后台切换或 SSE 连接结束后，客户端会有界退避并重新连接。重复 `/events` 是恢复行为；如果持续高频出现，请检查 Backend 是否立即关闭流、网络路径是否稳定，以及 OAuth Token 是否反复返回 401。

## 10. OpenAPI 生成包

OpenAPI 输入由 Backend/Protocol 单一来源生成：

```bash
pnpm ios:openapi
```

生成产物位于 `apps/ios/Packages/BeecodeAPI/`。App 当前通过稳定的 `BeecodeClient` 包装层运行，生成包暂未加入 Xcode App target。更新生成器或接入 target 前，应在网络可稳定完成依赖解析的环境生成并提交 SwiftPM `Package.resolved`，再检查生成 diff。
