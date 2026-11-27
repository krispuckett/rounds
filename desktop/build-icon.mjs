// Generate a packaging-sized PNG from the existing Rounds app artwork.
import { app, nativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
app.setName("Rounds Icon Build");
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "rounds-icon-")));
app.whenReady().then(() => {
  const image = nativeImage.createFromPath(path.join(here, "..", "public", "apple-touch-icon.png"));
  if (image.isEmpty()) throw new Error("Rounds icon is missing");
  const folder = path.join(here, "generated");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "icon.png"), image.resize({ width: 512, height: 512, quality: "best" }).toPNG());
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
