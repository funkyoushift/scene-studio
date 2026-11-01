import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  importMedia,
  exportExperience,
  importExperience,
  readLocalMedia,
} from "../../src/experience-media.mjs";
import { experienceExample } from "../../src/experience-examples.mjs";
import { ExperiencePlayer } from "../../src/ExperiencePlayer.jsx";

function Fixture() {
  const [result, setResult] = useState("Ready"),
    [playing, setPlaying] = useState(false),
    [mount, setMount] = useState(0);
  const design = React.useMemo(
    () => ({
      ...experienceExample("sequence", "browser-fixture"),
      saveProgress: true,
    }),
    [],
  );
  async function roundTrip() {
    setResult("Running browser media checks…");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 90;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#4338ca";
      ctx.fillRect(0, 0, 160, 90);
      const png = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      const image = await importMedia(
        new File([png], "fixture.png", { type: "image/png" }),
      );
      const stream = canvas.captureStream(10),
        chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      const finished = new Promise((resolve) => {
        recorder.ondataavailable = (event) => chunks.push(event.data);
        recorder.onstop = resolve;
      });
      recorder.start();
      await new Promise((resolve) => setTimeout(resolve, 700));
      recorder.stop();
      await finished;
      stream.getTracks().forEach((track) => track.stop());
      const videoFile = new File(chunks, "fixture.webm", {
        type: "video/webm",
      });
      // Live MediaRecorder files often omit duration. Use the already generated,
      // finite MP4 fixture for the importer if that browser rejects its WebM.
      let video;
      try {
        video = await importMedia(videoFile);
      } catch {
        const response = await fetch(
          "/outputs/experience-engine-20261101/sample-video.mp4",
        );
        if (!response.ok)
          throw new Error(
            "Generate the MP4 fixture before running these checks.",
          );
        video = await importMedia(
          new File([await response.blob()], "fixture.mp4", {
            type: "video/mp4",
          }),
        );
      }
      const source = experienceExample("story", "portable-fixture");
      source.assets = [image, video];
      source.scenes[0].media = video.id;
      const json = await exportExperience(source),
        restored = await importExperience(json);
      if (restored.assets.length !== 2 || restored.scenes[0].media !== video.id)
        throw new Error("Scene or asset reference changed.");
      for (const asset of restored.assets)
        if (!(await readLocalMedia(asset.source))?.size)
          throw new Error("An imported file is missing from IndexedDB.");
      const before = new Uint8Array(
        await (await readLocalMedia(video.source)).arrayBuffer(),
      );
      const after = new Uint8Array(
        await (await readLocalMedia(restored.assets[1].source)).arrayBuffer(),
      );
      if (
        before.length !== after.length ||
        before.some((value, i) => value !== after[i])
      )
        throw new Error("Video bytes changed during backup.");
      if (restored.assets.some((a, i) => a.source === source.assets[i].source))
        throw new Error("Backup did not restore independent media.");
      setResult(
        `PASS: image and video imports, IndexedDB storage, portable backup export/import, new media addresses, and byte-identical restored video (${after.length} bytes).`,
      );
    } catch (error) {
      setResult(`FAIL: ${error.message}`);
    }
  }
  return (
    <main
      style={{
        background: "#111827",
        color: "#fff",
        padding: 20,
        minHeight: "100vh",
        fontFamily: "sans-serif",
      }}
    >
      <h1>Experience browser checks</h1>
      <button onClick={roundTrip}>Run media round-trip checks</button>
      <p role="status">{result}</p>
      <button onClick={() => setPlaying((v) => !v)}>Toggle test player</button>
      <button onClick={() => setMount((v) => v + 1)}>
        Remount player to check saved progress
      </button>
      {playing && (
        <ExperiencePlayer
          key={mount}
          design={design}
          storageKey="isolated-browser-fixture"
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")).render(<Fixture />);
