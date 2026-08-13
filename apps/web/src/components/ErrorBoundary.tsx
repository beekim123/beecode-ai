import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Beecode Web render failed", { message: error.message, componentStack: info.componentStack });
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal-state">
        <p className="eyebrow">工作台已中断</p>
        <h1>Beecode 无法显示当前页面</h1>
        <p>{this.state.error.message}</p>
        <button className="primary-button" onClick={() => window.location.reload()} type="button">
          重新加载工作台
        </button>
      </main>
    );
  }
}
