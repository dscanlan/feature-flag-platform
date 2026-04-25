import ReactDOM from "react-dom/client";
import { App } from "./app.tsx";
import "./index.css";

// StrictMode is intentionally off for the e2e harness: the polling-fallback
// Playwright tests rely on a fixed-count `route.fulfill` mock for `/sdk/stream`,
// and StrictMode's dev-only mount→unmount→remount can fire an extra stream
// fetch from the discarded first client, which decrements the mock counter
// before the production-equivalent client gets to run. Production builds
// don't include StrictMode behavior either, so this matches what end-users see.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
