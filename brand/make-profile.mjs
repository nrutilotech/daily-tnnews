// Draws the DAILY TNNEWS profile picture (1080×1080). Instagram shows it as a small circle,
// so everything important sits inside the central circle. Run: node brand/make-profile.mjs
import fs from "node:fs";
import path from "node:path";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
GlobalFonts.registerFromPath(path.join(root, "fonts/NotoSans-ExtraBold.ttf"), "TN Bold");
GlobalFonts.registerFromPath(path.join(root, "fonts/NotoSans-SemiBold.ttf"), "TN Semi");

const S = 1080;
const cv = createCanvas(S, S);
const ctx = cv.getContext("2d");
const c = S / 2;

// deep navy background with a soft radial glow
const bg = ctx.createRadialGradient(c, c * 0.8, 50, c, c, S * 0.75);
bg.addColorStop(0, "#1B3A6B");
bg.addColorStop(1, "#08142A");
ctx.fillStyle = bg;
ctx.fillRect(0, 0, S, S);

// red ring just inside the circular crop
ctx.lineWidth = 34;
ctx.strokeStyle = "#E11D2E";
ctx.beginPath();
ctx.arc(c, c, S / 2 - 46, 0, Math.PI * 2);
ctx.stroke();
// thin yellow inner ring
ctx.lineWidth = 6;
ctx.strokeStyle = "#FFC93C";
ctx.beginPath();
ctx.arc(c, c, S / 2 - 82, 0, Math.PI * 2);
ctx.stroke();

ctx.textAlign = "center";
ctx.textBaseline = "alphabetic";

// "DAILY" in a red pill
ctx.font = '86px "TN Bold"';
const dw = ctx.measureText("DAILY").width + 90;
const dh = 124;
const dy = 268;
ctx.fillStyle = "#E11D2E";
ctx.beginPath();
ctx.roundRect(c - dw / 2, dy, dw, dh, 30);
ctx.fill();
ctx.fillStyle = "#FFFFFF";
ctx.fillText("DAILY", c, dy + 92);

// big "TN"
ctx.font = '330px "TN Bold"';
ctx.fillStyle = "#FFFFFF";
ctx.shadowColor = "rgba(0,0,0,0.35)";
ctx.shadowBlur = 24;
ctx.shadowOffsetY = 8;
ctx.fillText("TN", c, 700);
ctx.shadowColor = "transparent";

// "NEWS" in yellow with letter spacing
ctx.font = '104px "TN Bold"';
ctx.fillStyle = "#FFC93C";
ctx.letterSpacing = "18px";
ctx.fillText("NEWS", c + 9, 832);
ctx.letterSpacing = "0px";

// small "· 7 AM & 7 PM ·" line
ctx.font = '40px "TN Semi"';
ctx.fillStyle = "rgba(255,255,255,0.75)";
ctx.fillText("TAMIL NADU · TOP 10", c, 900);

fs.writeFileSync(path.join(root, "brand/profile.png"), await cv.encode("png"));
console.log("brand/profile.png written");
