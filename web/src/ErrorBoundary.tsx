import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center">
        <div>
          <p>Something broke 🐝</p>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{String(this.state.error.message)}</pre>
          <button onClick={() => (localStorage.removeItem("aubi.cache.v1"), location.reload())}>Reload</button>
        </div>
      </div>
    );
  }
}
