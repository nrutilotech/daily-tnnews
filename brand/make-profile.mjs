// Draws the DAILY TNNEWS profile picture (1080×1080): the Tamil Nadu map with a "news here" pin on
// Chennai, over the page's navy, with the wordmark below. Instagram crops it to a circle and shows it
// as small as ~110 px, so shapes are bold, there is no fine detail, and everything sits inside the circle.
// Quality: drawn at 2× and scaled down smoothly (crisp edges), with a light grain so the dark gradient
// doesn't band after Instagram re-compresses it. Saved as lossless PNG for upload.
// Run: node brand/make-profile.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
GlobalFonts.registerFromPath(path.join(root, "fonts/NotoSans-ExtraBold.ttf"), "TN Bold");
// Tamil Nadu outline from Natural Earth (public domain), simplified — see tamil-nadu.json
const { rings } = JSON.parse(fs.readFileSync(path.join(root, "brand/tamil-nadu.json"), "utf8"));

const S = 1080; // output size
const SS = 2; // supersampling factor
const c = S / 2;
const big = createCanvas(S * SS, S * SS);
const ctx = big.getContext("2d");
ctx.scale(SS, SS);
const blur = (px) => px * SS; // shadowBlur isn't affected by scale()

// ---- background: navy with a warm glow behind the map
let g = ctx.createRadialGradient(c, 430, 30, c, 520, 740);
g.addColorStop(0, "#26508F");
g.addColorStop(0.5, "#11295A");
g.addColorStop(1, "#071530");
ctx.fillStyle = g;
ctx.fillRect(0, 0, S, S);

// ---- map projection (equirectangular, scaled by cos(lat) so the shape isn't stretched)
const pts = rings.flat();
const lat0 = (Math.min(...pts.map((p) => p[1])) + Math.max(...pts.map((p) => p[1]))) / 2;
const kx = Math.cos((lat0 * Math.PI) / 180);
const xs = pts.map((p) => p[0] * kx);
const ys = pts.map((p) => p[1]);
const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
const mapH = 540;
const scale = mapH / (maxY - minY);
const mapW = (maxX - minX) * scale;
const left = c - mapW / 2 + 6;
const top = 118;
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

// glow
ctx.save();
ctx.shadowColor = "rgba(255,70,60,0.6)";
ctx.shadowBlur = blur(55);
mapPath();
ctx.fillStyle = "#E11D2E";
ctx.fill();
ctx.restore();

// red fill with a light top highlight
g = ctx.createLinearGradient(left, top, left + mapW * 0.6, top + mapH);
g.addColorStop(0, "#FF5A4F");
g.addColorStop(0.55, "#E8202F");
g.addColorStop(1, "#B5122B");
mapPath();
ctx.fillStyle = g;
ctx.fill();

// bold white coastline (reads at small sizes)
mapPath();
ctx.lineJoin = "round";
ctx.lineCap = "round";
ctx.lineWidth = 11;
ctx.strokeStyle = "#FFFFFF";
ctx.stroke();

// ---- "news here" pin on Chennai: two bold rings + solid dot
const [px, py] = proj([80.27, 13.08]);
for (const [r, a, w] of [
  [70, 0.35, 9],
  [44, 0.7, 9],
]) {
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255,201,60,${a})`;
  ctx.lineWidth = w;
  ctx.stroke();
}
ctx.save();
ctx.shadowColor = "rgba(255,201,60,0.9)";
ctx.shadowBlur = blur(26);
ctx.beginPath();
ctx.arc(px, py, 25, 0, Math.PI * 2);
ctx.fillStyle = "#FFC93C";
ctx.fill();
ctx.restore();
ctx.beginPath();
ctx.arc(px, py, 10, 0, Math.PI * 2);
ctx.fillStyle = "#FFFFFF";
ctx.fill();

// ---- wordmark: DAILY (red pill) + TN NEWS
ctx.textAlign = "center";
ctx.textBaseline = "alphabetic";
ctx.font = '62px "TN Bold"';
ctx.letterSpacing = "9px";
const dailyW = ctx.measureText("DAILY").width + 74;
const pillY = 690;
ctx.save();
ctx.shadowColor = "rgba(0,0,0,0.4)";
ctx.shadowBlur = blur(16);
ctx.fillStyle = "#E11D2E";
ctx.beginPath();
ctx.roundRect(c - dailyW / 2, pillY, dailyW, 88, 44);
ctx.fill();
ctx.restore();
ctx.fillStyle = "#FFFFFF";
ctx.fillText("DAILY", c + 4.5, pillY + 66);

ctx.letterSpacing = "0px";
ctx.font = '146px "TN Bold"';
const tnW = ctx.measureText("TN ").width;
const newsW = ctx.measureText("NEWS").width;
const startX = c - (tnW + newsW) / 2;
const baseY = 902;
ctx.textAlign = "left";
ctx.save();
ctx.shadowColor = "rgba(0,0,0,0.5)";
ctx.shadowBlur = blur(18);
ctx.shadowOffsetY = 6 * SS;
ctx.fillStyle = "#FFFFFF";
ctx.fillText("TN ", startX, baseY);
ctx.fillStyle = "#FFC93C";
ctx.fillText("NEWS", startX + tnW, baseY);
ctx.restore();

// ---- gold ring at the edge of Instagram's circle
ctx.beginPath();
ctx.arc(c, c, 514, 0, Math.PI * 2);
ctx.strokeStyle = "#FFC93C";
ctx.lineWidth = 12;
ctx.stroke();

// ---- scale down smoothly to the output size
const out = createCanvas(S, S);
const octx = out.getContext("2d");
octx.imageSmoothingEnabled = true;
octx.imageSmoothingQuality = "high";
octx.drawImage(big, 0, 0, S, S);

// light grain on the dark background only, so gradients don't band after compression
const img = octx.getImageData(0, 0, S, S);
const d = img.data;
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
for (let i = 0; i < d.length; i += 4) {
  if (d[i] + d[i + 1] + d[i + 2] < 300) {
    const n = rand() * 5;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
}
octx.putImageData(img, 0, 0);

fs.writeFileSync(path.join(root, "brand/profile.png"), await out.encode("png"));
fs.writeFileSync(path.join(root, "brand/profile.jpg"), await out.encode("jpeg", 100));

// previews at Instagram's real display sizes
for (const size of [330, 110]) {
  const small = createCanvas(size, size);
  const sctx = small.getContext("2d");
  sctx.imageSmoothingQuality = "high";
  sctx.beginPath();
  sctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  sctx.clip();
  sctx.drawImage(out, 0, 0, size, size);
  fs.writeFileSync(path.join(root, `brand/profile-preview-${size}.png`), await small.encode("png"));
}
console.log("brand/profile.png (upload this), profile.jpg and previews written");
