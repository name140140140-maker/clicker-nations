import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

// Telegram Mini App: сказати Telegram, що додаток готовий і розгорнути на весь екран
if (window.Telegram && window.Telegram.WebApp) {
  window.Telegram.WebApp.ready();
  window.Telegram.WebApp.expand();
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
