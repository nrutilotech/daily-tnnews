// Draws the DAILY TNNEWS profile picture (1080×1080): the Tamil Nadu map with a "news here" pin on
// Chennai, over the page's navy, with the wordmark below. Instagram crops it to a circle, so
// everything sits inside the central circle. Run: node brand/make-profile.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
GlobalFonts.registerFromPath(path.join(root, "fonts/NotoSans-ExtraBold.ttf"), "TN Bold");
GlobalFonts.registerFromPath(path.join(root, "fonts/NotoSans-SemiBold.ttf"), "TN Semi");
// Tamil Nadu outline from Natural Earth (public domain), simplified — see tamil-nadu.json
const { rings } = JSON.parse(fs.readFileSync(path.join(root, "brand/tamil-nadu.json"), "utf8"));

const S = 1080;
const c = S / 2;
const cv = createCanvas(S, S);
const ctx = cv.getContext("2d");

// ---- background: navy with a warm glow behind the map
let g = ctx.createRadialGradient(c, 420, 40, c, 520, 760);
g.addColorStop(0, "#22457E");
g.addColorStop(0.55, "#0E2147");
g.addColorStop(1, "#060F22");
ctx.fillStyle = g;
ctx.fillRect(0, 0, S, S);

// faint latitude/longitude grid, clipped to the circle
ctx.save();
ctx.beginPath();
ctx.arc(c, c, 520, 0, Math.PI * 2);
ctx.clip();
ctx.strokeStyle = "rgba(255,255,255,0.05)";
ctx.lineWidth = 2;
for (let x = 0; x <= S; x += 72) {
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, S);
  ctx.stroke();
}
for (let y = 0; y <= S; y += 72) {
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(S, y);
  ctx.stroke();
}
ctx.restore();

// ---- map projection (equirectangular, scaled by cos(lat) so the shape isn't stretched)
const pts = rings.flat();
const lat0 = (Math.min(...pts.map((p) => p[1])) + Math.max(...pts.map((p) => p[1]))) / 2;
const kx = Math.cos((lat0 * Math.PI) / 180);
const xs = pts.map((p) => p[0] * kx);
const ys = pts.map((p) => p[1]);
const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
const mapH = 520;
const scale = mapH / (maxY - minY);
const mapW = (maxX - minX) * scale;
const left = c - mapW / 2 + 10;
const top = 140;
const proj = ([lon, lat]) => [left + (lon * kx - minX) * scale, top + (maxY - lat) * scale];

function mapPath() {
  ctx.beginPath();
  for (const ring of rings) {
    ring.forEach((p, i) => {
      const [x, y] = proj(p);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.closePath();
  }
}

// soft glow
ctx.save();
ctx.shadowColor = "rgba(255,80,60,0.55)";
ctx.shadowBlur = 60;
mapPath();
ctx.fillStyle = "#E11D2E";
ctx.fill();
ctx.restore();

// red → orange fill
g = ctx.createLinearGradient(left, top, left + mapW, top + mapH);
g.addColorStop(0, "#FF4D4D");
g.addColorStop(0.5, "#E11D2E");
g.addColorStop(1, "#B0102A");
mapPath();
ctx.fillStyle = g;
ctx.fill();
// subtle highlight on the upper half
ctx.save();
mapPath();
ctx.clip();
g = ctx.createLinearGradient(0, top, 0, top + mapH);
g.addColorStop(0, "rgba(255,255,255,0.22)");
g.addColorStop(0.5, "rgba(255,255,255,0)");
ctx.fillStyle = g;
ctx.fillRect(0, top, S, mapH);
ctx.restore();
// white coastline
mapPath();
ctx.lineJoin = "round";
ctx.lineWidth = 7;
ctx.strokeStyle = "#FFFFFF";
ctx.stroke();

// ---- "news here" pin on Chennai with pulse rings
const [px, py] = proj([80.27, 13.08]);
for (const [r, a] of [
  [80, 0.18],
  [58, 0.32],
  [38, 0.55],
]) {
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255,201,60,${a})`;
  ctx.lineWidth = 6;
  ctx.stroke();
}
ctx.beginPath();
ctx.arc(px, py, 22, 0, Math.PI * 2);
ctx.fillStyle = "#FFC93C";
ctx.shadowColor = "rgba(255,201,60,0.9)";
ctx.shadowBlur = 30;
ctx.fill();
ctx.shadowBlur = 0;
ctx.beginPath();
ctx.arc(px, py, 9, 0, Math.PI * 2);
ctx.fillStyle = "#FFFFFF";
ctx.fill();

// ---- wordmark: DAILY (red pill) + TN NEWS
ctx.textAlign = "center";
ctx.textBaseline = "alphabetic";
ctx.font = '58px "TN Bold"';
ctx.letterSpacing = "10px";
const dailyW = ctx.measureText("DAILY").width + 70;
const pillY = 700;
ctx.fillStyle = "#E11D2E";
ctx.shadowColor = "rgba(0,0,0,0.35)";
ctx.shadowBlur = 18;
ctx.beginPath();
ctx.roundRect(c - dailyW / 2, pillY, dailyW, 84, 42);
ctx.fill();
ctx.shadowBlur = 0;
ctx.fillStyle = "#FFFFFF";
ctx.fillText("DAILY", c + 5, pillY + 63);

ctx.letterSpacing = "2px";
ctx.font = '150px "TN Bold"';
const tnW = ctx.measureText("TN ").width;
const newsW = ctx.measureText("NEWS").width;
const startX = c - (tnW + newsW) / 2;
const baseY = 930;
ctx.textAlign = "left";
ctx.shadowColor = "rgba(0,0,0,0.45)";
ctx.shadowBlur = 20;
ctx.shadowOffsetY = 6;
ctx.fillStyle = "#FFFFFF";
ctx.fillText("TN ", startX, baseY);
ctx.fillStyle = "#FFC93C";
ctx.fillText("NEWS", startX + tnW, baseY);
ctx.shadowColor = "transparent";
ctx.letterSpacing = "0px";

// ---- thin gold ring at the edge of Instagram's circle
ctx.beginPath();
ctx.arc(c, c, 516, 0, Math.PI * 2);
ctx.strokeStyle = "rgba(255,201,60,0.85)";
ctx.lineWidth = 8;
ctx.stroke();

fs.writeFileSync(path.join(root, "brand/profile.png"), await cv.encode("png"));
fs.writeFileSync(path.join(root, "brand/profile.jpg"), await cv.encode("jpeg", 95));

// preview of how it looks as Instagram's small round icon
const small = createCanvas(330, 330);
const sctx = small.getContext("2d");
sctx.beginPath();
sctx.arc(165, 165, 165, 0, Math.PI * 2);
sctx.clip();
sctx.drawImage(cv, 0, 0, 330, 330);
fs.writeFileSync(path.join(root, "brand/profile-preview-round.png"), await small.encode("png"));
console.log("brand/profile.png, profile.jpg and profile-preview-round.png written");
