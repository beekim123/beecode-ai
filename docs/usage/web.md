# Beecode Web 使用文档

## 1. 本地启动

环境要求为 Node.js 20+ 和 pnpm 10+。安装依赖后分别启动 Backend 与 Web：

```bash
pnpm install --frozen-lockfile
pnpm backend
```

```bash
pnpm web
```

打开 `http://127.0.0.1:5173`。本地 loopback Backend 默认启用 development identity provider；它只用于开发和自动化测试，不应在生产环境启用。

## 2. Web Agent 闭环

登录后创建 Session，在 Composer 输入：

```text
计算 1+1
```

预期依次看到 calculator Tool Call、Tool Result `2` 和最终回答 `1+1 = 2`。Turn 在 Backend Runtime 中继续执行，刷新页面后 Web 会重新读取权威快照并恢复完整结果。

Web 端支持：

- Session 创建、列表、重命名、归档和分页读取。
- HTTP 接受式 Turn 提交、幂等键、同 Session 并发保护和取消。
- SSE 实时事件、sequence、心跳、断线重连和快照合并。
- Tool 详情、额度与 Capability 页面、浅色/深色主题。
- 用户显式选择目录后，通过当前标签页的目录句柄按需运行 `read_file`。
- 桌面 Sidebar 与移动端抽屉布局。

Web Runtime 支持 `calculator`，并可对浏览器授权的目录使用 `read_file`。在 Composer 上方点击文件夹按钮选择目录后，选择动作只保存浏览器目录句柄，不读取或上传文件。模型请求列目录或读取文件时，当前标签页才访问对应相对路径并把该次结果返回 Backend；移除 Workspace 后该能力立即停止用于后续 Turn。

Web Workspace 是当前标签页内临时持有的只读目录授权。Turn 只提交随机 Workspace ID 和显示名称；绝对路径、目录清单和目录内容都不会随 Turn 上传，Workspace 也不会写入 Session 历史。页面刷新后需要重新选择目录。`read_file` 单次最多列出 250 个文件，只读取 12 KiB 以内的有效 UTF-8 文本；二进制、超大文件、危险相对路径和失效权限会被拒绝。Chrome、Edge 等支持 File System Access API 的浏览器可使用该能力，不支持时入口会显示不可用。Shell、Git、文件写入、附件和本机凭据仍不可用。

## 3. 认证与账号

浏览器使用 `HttpOnly`、`SameSite=Lax` Session Cookie。CLI 使用浏览器授权、Authorization Code 和 PKCE，并与 Web 解析到同一个稳定 Account。Access Token 短期有效，Refresh Token 每次刷新都会轮换；旧 Refresh Token 重用会撤销整个 token family。

本地 CLI 登录：

```bash
pnpm --filter @beecode/cli start login
pnpm --filter @beecode/cli start whoami
```

Web 与 CLI 共用账号和额度，但 Web Session 不会出现在 CLI Session API 中，反之亦然。

## 4. 配置

与 Web 相关的 Backend 环境变量：

| 变量                                             | 默认值                    | 说明                                       |
| ------------------------------------------------ | ------------------------- | ------------------------------------------ |
| `BEECODE_WEB_ORIGIN`                           | `http://127.0.0.1:5173` | 允许执行浏览器写操作的精确 Origin          |
| `BEECODE_PUBLIC_BASE_URL`                      | Backend 监听 URL          | 外部可访问的 Backend 基础 URL              |
| `BEECODE_COOKIE_SECURE`                        | `false`                 | 生产 HTTPS 环境必须设为`true`            |
| `BEECODE_DEV_AUTH_ENABLED`                     | loopback 时为`true`     | 是否启用 development identity 与 dev-token |
| `BEECODE_BROWSER_SESSION_TTL_SECONDS`          | `2592000`               | 浏览器 Session 有效期                      |
| `BEECODE_ACCESS_TOKEN_TTL_SECONDS`             | `900`                   | CLI Access Token 有效期                    |
| `BEECODE_REFRESH_TOKEN_TTL_SECONDS`            | `2592000`               | CLI Refresh Token 有效期                   |
| `BEECODE_AUTHORIZATION_CODE_TTL_SECONDS`       | `300`                   | 一次性授权码有效期                         |
| `BEECODE_MAX_CONCURRENT_WEB_TURNS_PER_ACCOUNT` | `4`                     | 单账号同时运行的 Web Turn 上限             |

Vite 开发服务器把 `/v1`、`/oauth` 和 `/openapi.json` 代理到 `127.0.0.1:8787`。Web Client 的写请求同时携带 `X-Beecode-CSRF: 1`，用于在受控代理或浏览器扩展重写 Origin 时保留显式 CSRF 防护。生产部署应保持同源拓扑或等价的受控反向代理，并关闭 development identity。

## 5. 测试与验证

```bash
pnpm check
pnpm test:e2e
```

Playwright 覆盖登录、calculator、刷新恢复、第二浏览器上下文、OAuth Bearer surface 隔离、移动抽屉、暗色主题、横向溢出与浏览器 console error。失败时保留 trace 和截图；成功截图写入 Playwright 测试输出目录。

真实模型 Smoke Test 会产生外部调用和费用，需显式提供 Anthropic Key：

```bash
ANTHROPIC_API_KEY=your-key pnpm test:smoke
```

## 6. 生产接入边界

当前仓库完成了身份提供商、Session Repository 和 CLI Credential Store 的稳定接口，并提供 development identity、JSON migration store 与 `0600` 文件凭据回退。正式部署前仍需根据部署环境选择并实现：

1. 正式身份提供商适配器。
2. 关系数据库 Repository 与迁移工具。
3. 操作系统钥匙串适配器。
4. 正式域名、TLS、Cookie Domain、密钥管理与分布式 Runtime 策略。

这些是部署选择，不影响本地 Phase 2 纵向闭环和公开协议。
