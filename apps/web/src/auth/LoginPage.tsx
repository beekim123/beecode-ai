import { ArrowRight, Braces } from "lucide-react";
import { webTransport } from "../lib/api.js";
import { safeReturnTarget } from "../lib/navigation.js";

export function LoginPage(): React.JSX.Element {
  const returnTo = safeReturnTarget(new URLSearchParams(window.location.search).get("returnTo"));
  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="brand-mark" aria-hidden="true"><Braces size={22} /></div>
        <p className="eyebrow">Beecode 工作台</p>
        <h1 id="login-title">继续你的 Agent 工作</h1>
        <p className="login-copy">
          会话、运行状态和额度统一关联到 Beecode 账号，可在浏览器与命令行之间保持一致。
        </p>
        <a className="primary-button login-action" href={webTransport.loginUrl("development", returnTo)}>
          使用开发账号登录 <ArrowRight size={17} aria-hidden="true" />
        </a>
        <p className="login-footnote">开发身份提供方仅在本地和测试后端启用。</p>
      </section>
      <aside className="login-context" aria-label="产品能力">
        <span>后端运行环境</span><span>SSE 实时恢复</span><span>账号共享额度</span>
      </aside>
    </main>
  );
}
