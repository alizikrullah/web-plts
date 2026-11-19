import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router"
import App from "./app/App"
import { SessionProvider } from "./core/session"
import "./core/styles.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode><BrowserRouter><SessionProvider><App /></SessionProvider></BrowserRouter></StrictMode>,
)
