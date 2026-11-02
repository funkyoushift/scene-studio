import React from "react";
import { createRoot } from "react-dom/client";
import AutomationStudio from "../src/AutomationStudio.jsx";
import "../src/style.css";
const back = () => {
  location.href = "./full-editor.html" + location.search;
};
createRoot(document.getElementById("root")).render(
  <AutomationStudio onBack={back} />,
);

import "./editor-return.mjs";
