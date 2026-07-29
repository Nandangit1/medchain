import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ToastContainer } from "react-toastify";

import App from "./App.jsx";
import { ErrorBoundary } from "./components/common";
import { AuthProvider } from "./context/AuthContext";

import "bootstrap/dist/css/bootstrap.min.css";
import "react-toastify/dist/ReactToastify.css";
import "./styles/theme.css";

// Apply the saved theme before first paint to avoid a light-mode flash.
document.documentElement.setAttribute("data-theme", localStorage.getItem("bts.theme") || "light");

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
          <ToastContainer
            position="top-right"
            autoClose={4000}
            newestOnTop
            theme={localStorage.getItem("bts.theme") === "dark" ? "dark" : "light"}
          />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);
