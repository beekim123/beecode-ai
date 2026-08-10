# Beecode CLI 使用文档

## 1. 当前范围

第一阶段包含两个运行单元：

- 本地 CLI：行式交互、Agent Runtime、Agent Loop 和 `calculator` 工具。
- Beecode Backend：开发身份、CLI Session、额度和 Model Gateway。

CLI 不持有模型供应商密钥。真实模型密钥只配置在 Backend。当前不包含 Shell、文件、Git、MCP、WebSocket 或多代理工具。

## 2. 环境要求

- Node.js 20 或更高版本。
- pnpm 10 或更高版本。

安装依赖：

```bash
corepack enable
pnpm install --frozen-lockfile
```

## 3. 使用 Fake Provider 快速启动

Fake Provider 不访问外部模型，也不会产生模型费用，适合本地开发和验收 calculator 闭环。

在第一个终端启动 Backend：

```bash
pnpm backend
```

默认监听 `http://127.0.0.1:8787`，数据保存到 `~/.beecode/backend-data.json`。

在第二个终端登录：

```bash
pnpm --filter @beecode/cli start login
```

登录信息保存到 `~/.beecode/config.json`。配置目录权限为 `0700`，文件权限为 `0600`。

进入交互模式：

```bash
pnpm cli
```

输入：

```text
计算 1+1
```

预期可区分地显示 Tool Call、Tool Result 和最终回答：

```text
Tool: calculator({"expression":"1+1"})
Result: 2
Agent: 1+1 = 2
```

## 4. CLI 命令

| 命令           | 行为                               |
| -------------- | ---------------------------------- |
| `/new`       | 创建新的 CLI Session               |
| `/sessions`  | 列出当前账号的 CLI Session         |
| `/open <id>` | 打开 Session 并加载完整历史快照    |
| `/cancel`    | 取消当前 Turn，包括正在启动的 Turn |
| `/help`      | 显示命令帮助                       |
| `/exit`      | 在没有活动 Turn 时退出             |

直接关闭 stdin 或按 `Ctrl-D` 时，CLI 会先请求取消活动 Turn，并等待终态保存。

## 5. 使用真实模型 Provider

只在 Backend 进程配置供应商密钥。推荐写入项目根目录的 `backend-config.json`（已在 `.gitignore` 中，不会提交），或全局的 `~/.beecode/backend-config.json`：

```json
{
  "provider": "anthropic",
  "anthropicApiKey": "your-key",
  "anthropicModel": "your-model-id"
}
```

配置文件包含密钥，建议设置 `0600` 权限：

```bash
chmod 600 ~/.beecode/backend-config.json
```

也可以用环境变量配置；环境变量会覆盖配置文件中的同名设置：

```bash
BEECODE_PROVIDER=anthropic \
ANTHROPIC_API_KEY=your-key \
ANTHROPIC_MODEL=your-model-id \
pnpm backend
```

CLI 的登录和启动命令不变。不要把供应商密钥写入 CLI 配置、Session 或命令输出。

### OpenAI 兼容 Provider（DeepSeek、千问等）

`openai` Provider 走 OpenAI Chat Completions 协议，通过 `openaiBaseUrl` 切换供应商，DeepSeek、通义千问（DashScope 兼容模式）、Kimi 等都可以接入。`openaiApiKey` 和 `openaiModel` 必填。

DeepSeek 配置示例：

```json
{
  "provider": "openai",
  "openaiApiKey": "your-deepseek-key",
  "openaiModel": "deepseek-chat",
  "openaiBaseUrl": "https://api.deepseek.com/v1"
}
```

通义千问（DashScope 兼容模式）配置示例：

```json
{
  "provider": "openai",
  "openaiApiKey": "your-dashscope-key",
  "openaiModel": "qwen-plus",
  "openaiBaseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1"
}
```

对应的环境变量是 `OPENAI_API_KEY`、`OPENAI_MODEL` 和 `OPENAI_BASE_URL`；不设置 `openaiBaseUrl` 时默认请求 OpenAI 官方接口。

## 6. 真实模型 Smoke Test

以下命令会产生一次真实模型调用。它会启动临时 Backend，并经过 HTTP Model Gateway、Anthropic Adapter、Agent Runtime 和 calculator 验证“计算 1+1”：

```bash
ANTHROPIC_API_KEY=your-key pnpm test:smoke
```

指定模型：

```bash
ANTHROPIC_API_KEY=your-key \
ANTHROPIC_MODEL=your-model-id \
pnpm test:smoke
```

未提供 `ANTHROPIC_API_KEY` 时命令会失败，不会静默跳过或产生请求。

## 7. Backend 与 CLI 配置

### Backend 配置文件

Backend 启动时读取 JSON 配置文件，路径按以下顺序解析：`BEECODE_BACKEND_CONFIG` 环境变量 > 项目根目录的 `backend-config.json`（从启动目录向上查找 `pnpm-workspace.yaml` 定位项目根，该文件已加入 `.gitignore`）> `~/.beecode/backend-config.json`。文件不存在时按空配置处理。可先用 `cp backend-config.example.json backend-config.json` 创建本地配置；示例使用 DeepSeek 的 OpenAI 兼容接口，需将 API Key 占位符替换为自己的密钥。支持的键与 `BackendConfig` 字段同名：`host`、`port`、`quotaLimitTokens`、`provider`、`devLoginSecret`、`anthropicApiKey`、`anthropicModel`、`openaiApiKey`、`openaiModel`、`openaiBaseUrl`、`dataFile`。文件包含未知键、非法 JSON 或类型错误时 Backend 拒绝启动。

环境变量优先于配置文件；未设置环境变量时使用文件值；两者都没有时使用下表默认值。

### Backend 环境变量

| 变量                           | 默认值                             | 说明                                  |
| ------------------------------ | ---------------------------------- | ------------------------------------- |
| `BEECODE_BACKEND_CONFIG`     | `~/.beecode/backend-config.json` | Backend 配置文件路径                  |
| `BEECODE_BACKEND_HOST`       | `127.0.0.1`                      | Backend 监听地址                      |
| `BEECODE_BACKEND_PORT`       | `8787`                           | Backend 端口                          |
| `BEECODE_BACKEND_DATA`       | `~/.beecode/backend-data.json`   | Session、Turn、账号和额度数据文件     |
| `BEECODE_QUOTA_LIMIT_TOKENS` | `1000000`                        | 每个开发账号的 Token 额度             |
| `BEECODE_PROVIDER`           | `fake`                           | `fake`、`anthropic` 或 `openai` |
| `ANTHROPIC_API_KEY`          | 无                                 | Anthropic Provider 必填               |
| `ANTHROPIC_MODEL`            | 内置默认值                         | 可选模型 ID                           |
| `OPENAI_API_KEY`             | 无                                 | OpenAI 兼容 Provider 必填             |
| `OPENAI_MODEL`               | 无                                 | OpenAI 兼容 Provider 必填             |
| `OPENAI_BASE_URL`            | `https://api.openai.com/v1`      | OpenAI 兼容接口地址                   |
| `BEECODE_DEV_LOGIN_SECRET`   | 无                                 | 非 loopback 监听时必填                |

### CLI 环境变量

| 变量                         | 默认值                    | 说明                                                |
| ---------------------------- | ------------------------- | --------------------------------------------------- |
| `BEECODE_BACKEND_URL`      | `http://127.0.0.1:8787` | CLI 访问的 Backend URL                              |
| `BEECODE_HOME`             | `~/.beecode`            | CLI 配置目录                                        |
| `BEECODE_DEV_LOGIN_SECRET` | 无                        | 登录受保护的开发 Backend 时发送；不会保存到配置文件 |

数值配置非法、Provider 名称未知，或者 Backend 监听非 loopback 地址但没有开发登录密钥时，Backend 会拒绝启动。

## 8. 跨设备开发使用

默认 Backend 只允许本机连接。如果需要从另一台 CLI 设备访问开发 Backend，至少配置开发登录密钥：

Backend：

```bash
BEECODE_BACKEND_HOST=0.0.0.0 \
BEECODE_DEV_LOGIN_SECRET=a-long-random-secret \
pnpm backend
```

另一台 CLI：

```bash
BEECODE_BACKEND_URL=http://backend-host:8787 \
BEECODE_DEV_LOGIN_SECRET=a-long-random-secret \
pnpm --filter @beecode/cli start login
```

开发登录每次会创建新账号。若要让第二台 CLI 查看同一账号历史，需要通过安全通道部署同一份 CLI `token` 和 `accountId` 配置，并保持 `0600` 权限。

Backend 当前没有内置 TLS。不要把端口直接暴露到公网；跨不可信网络时应在前面部署 TLS 反向代理和正式身份系统。

## 9. Session、Turn 与恢复

- Session、Message、Turn 终态和额度由 Backend 保存。
- 每个 Session 同时只允许一个活动 Turn。
- CLI 重启后读取完整快照，不重放旧在线事件。
- completed、failed 和 cancelled Turn 都会持久化。
- Session 使用乐观版本号；发生 `SESSION_VERSION_CONFLICT` 时不会自动合并或覆盖远端历史。
- Backend 数据文件损坏或无法读取时会拒绝启动，不会自动覆盖为空数据。

## 10. 开发检查

运行类型检查：

```bash
pnpm typecheck
```

运行全部自动化测试：

```bash
pnpm test
```

连续运行类型检查和测试：

```bash
pnpm check
```

自动化测试覆盖协议校验、Agent Loop、Tool 超时/取消、Facade 持久化顺序、账号和 Surface 隔离、额度预留、JSON Store、CLI 配置权限、进程内 E2E 和真实 CLI 子进程入口。默认测试不访问外部模型。

## 11. 常见问题

### `UNAUTHENTICATED`

令牌不存在、失效，或 CLI 指向了不同 Backend。重新执行登录命令。

### `FORBIDDEN`

Backend 配置了 `BEECODE_DEV_LOGIN_SECRET`，但 CLI 未提供或提供错误。

### `QUOTA_EXCEEDED`

账号剩余额度不足以预留下一次模型请求。提高开发额度或使用新开发账号。

### `SESSION_VERSION_CONFLICT`

另一台 CLI 已更新该 Session。使用 `/open <id>` 重新加载最新快照，不要覆盖远端内容。

### `MODEL_TIMEOUT` 或 `MODEL_STREAM_ERROR`

检查 Backend、供应商配置和网络。模型流缺少合法 `finish`、返回截断或事件格式无效时，Turn 会失败而不会伪装为完成。

### Backend 无法读取数据文件

检查 `BEECODE_BACKEND_DATA` 指向的文件权限和 JSON 完整性。先备份损坏文件再进行人工恢复；Backend 不会自动清空它。
