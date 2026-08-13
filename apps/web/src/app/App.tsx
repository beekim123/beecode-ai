import { useEffect, useState } from "react";
import { BeecodeError, ErrorCodes, type AccountSummary } from "@beecode/protocol";
import { LoginPage } from "../auth/LoginPage.js";
import { webTransport } from "../lib/api.js";
import { localizedErrorMessage } from "../lib/localization.js";
import { navigate, usePathname } from "../lib/navigation.js";
import { Workspace } from "./Workspace.js";

type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; account: AccountSummary }
  | { status: "unauthenticated" }
  | { status: "error"; error: BeecodeError };

export function App(): React.JSX.Element {
  const pathname = usePathname();
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void webTransport.getCurrentAccount().then(
      (account) => { if (active) setAuth({ status: "authenticated", account }); },
      (caught: unknown) => {
        if (!active) return;
        const error = BeecodeError.fromUnknown(caught);
        setAuth(
          error.code === ErrorCodes.UNAUTHENTICATED || error.code === ErrorCodes.TOKEN_EXPIRED
            ? { status: "unauthenticated" }
            : { status: "error", error },
        );
      },
    );
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (auth.status === "authenticated" && (pathname === "/login" || pathname === "/")) navigate("/app");
  }, [auth.status, pathname]);

  if (auth.status === "loading") return <AppBoot />;
  if (auth.status === "error") {
    return <main className="fatal-state"><p className="eyebrow">后端不可用</p><h1>无法打开 Beecode</h1><p>{localizedErrorMessage(auth.error)}</p><button className="primary-button" type="button" onClick={() => window.location.reload()}>重试</button></main>;
  }
  if (auth.status === "unauthenticated") {
    if (window.location.pathname !== "/login") {
      const returnTo = encodeURIComponent(`${pathname}${window.location.search}`);
      window.history.replaceState({}, "", `/login?returnTo=${returnTo}`);
    }
    return <LoginPage />;
  }
  return <Workspace account={auth.account} pathname={pathname} />;
}

function AppBoot(): React.JSX.Element {
  return <main className="boot-screen" aria-label="正在加载 Beecode"><div className="boot-mark">B</div><div className="boot-line"><span /></div></main>;
}
