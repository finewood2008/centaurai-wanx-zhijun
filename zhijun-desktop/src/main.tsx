import React from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import i18n, { initI18n } from "../../dashboard/src/i18n";
import App from "./App";
import "./style.css";
await initI18n();
await i18n.changeLanguage("zh");
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#a6452e",
          colorBgContainer: "#fffcf6",
          fontFamily: '-apple-system, "PingFang SC", sans-serif',
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
