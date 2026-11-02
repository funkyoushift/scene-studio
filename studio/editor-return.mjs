const bar = document.createElement("div");
bar.className = "trial-return-bar";
const back = document.createElement("button");
back.textContent = "← Back to scene preview";
back.onclick = () => {
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage(
      { source: "studio-full-editor", action: "return-preview" },
      location.origin,
    );
    window.opener.focus();
  } else {
    status.textContent =
      "Return to the gallery tab, open All tools, and choose Bring back full-editor changes.";
  }
};
const status = document.createElement("span");
status.textContent =
  "Full editor · isolated local draft. Return brings your saved edits into the new UI.";
status.setAttribute("role", "status");
window.addEventListener("scene-studio-preview-ready", () => back.onclick());
bar.append(back, status);
document.body.prepend(bar);
const style = document.createElement("style");
style.textContent =
  ".trial-return-bar{position:sticky;top:0;z-index:10000;display:flex;align-items:center;gap:16px;padding:12px 20px;background:#211d31;color:#ebe2ff;border-bottom:1px solid #8c77bd;font:14px system-ui}.trial-return-bar button{padding:12px;background:#d5c9ff;color:#211a39;border:0;border-radius:8px;font:600 14px system-ui;cursor:pointer}.trial-return-bar span{max-width:700px}";
document.head.append(style);

const gameNote = document.createElement("span");
gameNote.className = "trial-game-note";
gameNote.textContent =
  "Use Save & return to scene preview to try your game edits.";
bar.append(gameNote);
style.textContent +=
  " .trial-game-note{display:none}body:has(.experience-studio) .trial-return-bar button,body:has(.experience-studio) .trial-return-bar>span:not(.trial-game-note){display:none}body:has(.experience-studio) .trial-game-note{display:block}";
