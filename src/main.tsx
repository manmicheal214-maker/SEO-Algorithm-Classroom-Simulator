import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

class AppErrorBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("SEO Strategy Lab failed to render:", error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return <main style={{maxWidth: 760, margin: "48px auto", padding: 24, fontFamily: "system-ui", color: "#202b3c"}}>
        <h1>SEO Strategy Lab could not load</h1>
        <p>The app hit an unexpected error instead of showing a blank page. Refresh once; if it continues, share the diagnostic message below.</p>
        <pre style={{whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "#f4f6fb", padding: 16, borderRadius: 8}}>{this.state.error.message}</pre>
        <button onClick={() => window.location.reload()}>Reload application</button>
      </main>;
    }
    return this.props.children;
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("Required #root element is missing from index.html.");
createRoot(root).render(<React.StrictMode><AppErrorBoundary><App /></AppErrorBoundary></React.StrictMode>);
