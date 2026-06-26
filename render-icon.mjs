import sharp from "sharp";
import { readFileSync } from "node:fs";

const svg = readFileSync("app-icon.svg");

await sharp(svg, { density: 384 })
  .resize(1024, 1024, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile("app-icon.png");

console.log("wrote app-icon.png");
