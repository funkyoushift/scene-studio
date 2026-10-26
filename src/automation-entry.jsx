import React from "react";
import { createRoot } from "react-dom/client";
import AutomationStudio from "./AutomationStudio.jsx";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/manrope/latin-800.css";
// Standalone preview page only; embedded editors never change body styles.
document.body.style.margin = "0";
createRoot(document.getElementById("root")).render(<AutomationStudio />);
