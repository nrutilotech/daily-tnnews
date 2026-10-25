// Step 4: draw the carousel slides (1080×1350, Instagram's 4:5 portrait size) as JPEGs.
import path from "node:path";
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { config } from "./config.js";

const W = 1080;
const H = 1350;
const PAD = 64;

const C = {
  navy: "#0A1A33",
  red: "#E11D2E",
  yellow: "#FFC93C",
  paper: "#F7F5F0",
  ink: "#0F172A",
  gray: "#475467",
  line: "#D9D4C7",
};

export const CATEGORY_COLORS = {
  Government: "#E11D2E",
  Policy: "#B4235A",
  Weather: "#0284C7",
  Sports: "#16A34A",
  Business: "#7C3AED",
  Education: "#EA580C",
  Health: "#0D9488",
  Agriculture: "#65A30D",
  Transport: "#2563EB",
  "Law & Order": "#475569",
  Technology: "#4F46E5",
  Environment: "#15803D",
  Culture: "#C2410C",
  Politics: "#9333EA",
};

let fontsReady = false;
function registerFonts() {
  if (fontsReady) return;
  const f = (n) => path.join(config.fontsDir, n);
  GlobalFonts.registerFromPath(f("NotoSans-Regular.ttf"), "TN Regular");
  GlobalFonts.registerFromPath(f("NotoSans-SemiBold.ttf"), "TN Semi");
  GlobalFonts.registerFromPath(f("NotoSans-ExtraBold.ttf"), "TN Bold");
  GlobalFonts.registerFromPath(f("NotoSansTamil-Regular.ttf"), "TN Tamil");
  GlobalFonts.registerFromPath(f("NotoSansTamil-Bold.ttf"), "TN Tamil Bold");
  fontsReady = true;
}

// Latin font first, Tamil font as fallback for Tamil characters.
const font = (weight, size) => {
  const fam = { regular: '"TN Regular", "TN Tamil"', semi: '"TN Semi", "TN Tamil Bold"', bold: '"TN Bold", "TN Tamil Bold"' }[weight];
  return `${size}px ${fam}`;
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawImageCover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s;
  const sh = h / s;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

// Break text into lines that fit maxWidth. Returns null if it needs more than maxLines.
function wrapLines(ctx, text, maxWidth) {
  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width <= maxWidth || !line) line = test;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function ellipsize(ctx, lines, maxLines, maxWidth) {
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length && ctx.measureText(last + "…").width > maxWidth) last = last.replace(/\s*\S+$/, "");
  kept[maxLines - 1] = last + "…";
  return kept;
}

// Largest font size (from sizes[]) whose wrapped text fits in maxLines.
function fitText(ctx, text, weight, sizes, maxWidth, maxLines) {
  for (const size of sizes) {
    ctx.font = font(weight, size);
    const lines = wrapLines(ctx, text, maxWidth);
    if (lines.length <= maxLines) return { size, lines };
  }
  const size = sizes[sizes.length - 1];
  ctx.font = font(weight, size);
  return { size, lines: ellipsize(ctx, wrapLines(ctx, text, maxWidth), maxLines, maxWidth) };
}

function drawLines(ctx, lines, x, y, size, lh) {
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * size * lh));
  return y + lines.length * size * lh;
}

function chip(ctx, text, x, y, bg, fg = "#fff", size = 26) {
  ctx.font = font("bold", size);
  const label = text.toUpperCase();
  const w = ctx.measureText(label).width + 40;
  const h = size + 24;
  ctx.fillStyle = bg;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 20, y + h / 2 + 1);
  ctx.textBaseline = "alphabetic";
  return { w, h };
}

// "DAILY" in a red block + "TNNEWS" beside it.
function wordmark(ctx, x, y, scale = 1, light = true) {
  const [first, ...rest] = config.brand.split(/\s+/);
  const second = rest.join(" ");
  const size = Math.round(34 * scale);
  ctx.font = font("bold", size);
  const w1 = ctx.measureText(first).width + 28 * scale;
  const h = size + 22 * scale;
  ctx.fillStyle = C.red;
  roundRect(ctx, x, y, w1, h, 10 * scale);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(first, x + 14 * scale, y + h / 2 + 1);
  ctx.fillStyle = light ? "#fff" : C.ink;
  ctx.fillText(second, x + w1 + 12 * scale, y + h / 2 + 1);
  ctx.textBaseline = "alphabetic";
  return { w: w1 + 12 * scale + ctx.measureText(second).width, h };
}

function fallbackBackground(ctx, x, y, w, h, color, label) {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, color);
  g.addColorStop(1, C.navy);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // subtle diagonal stripes
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 28;
  for (let i = -h; i < w; i += 90) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.font = font("bold", 150);
  const fit = Math.min(150, Math.floor((150 * (w - 120)) / ctx.measureText(label.toUpperCase()).width));
  ctx.font = font("bold", fit);
  ctx.textAlign = "center";
  ctx.fillText(label.toUpperCase(), x + w / 2, y + h / 2 + 50);
  ctx.textAlign = "left";
  ctx.restore();
}

function credit(ctx, text, x, y, align = "right") {
  if (!text) return;
  ctx.font = font("regular", 20);
  ctx.textAlign = align;
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText(text, x, y);
  ctx.textAlign = "left";
}

async function cover(story, photo, meta) {
  const cv = createCanvas(W, H);
  const ctx = cv.getContext("2d");
  const color = CATEGORY_COLORS[story.category] ?? C.red;

  if (photo) drawImageCover(ctx, await loadImage(photo.buffer), 0, 0, W, H);
  else fallbackBackground(ctx, 0, 0, W, H, color, story.category);

  let g = ctx.createLinearGradient(0, 0, 0, 300);
  g.addColorStop(0, "rgba(6,12,26,0.70)");
  g.addColorStop(1, "rgba(6,12,26,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, 300);
  g = ctx.createLinearGradient(0, 430, 0, H);
  g.addColorStop(0, "rgba(6,12,26,0)");
  g.addColorStop(0.45, "rgba(6,12,26,0.86)");
  g.addColorStop(1, "rgba(6,12,26,0.97)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 430, W, H - 430);

  wordmark(ctx, PAD, PAD, 1.25);

  // edition + date, top right
  ctx.textAlign = "right";
  ctx.fillStyle = C.yellow;
  ctx.font = font("bold", 28);
  ctx.fillText(meta.editionLabel.toUpperCase(), W - PAD, PAD + 30);
  ctx.fillStyle = "#fff";
  ctx.font = font("semi", 26);
  ctx.fillText(meta.dateLabel, W - PAD, PAD + 66);
  ctx.textAlign = "left";

  // bottom-anchored text block
  const maxW = W - PAD * 2;
  const head = fitText(ctx, story.headline, "bold", [80, 74, 68, 62, 56], maxW, 4);
  const sumFit = fitText(ctx, story.summary, "regular", [33, 31, 29, 27], maxW, head.lines.length > 3 ? 3 : 4);
  const sum = sumFit.lines;
  const sumSize = sumFit.size;
  const headH = head.lines.length * head.size * 1.14;
  const sumH = sum.length * sumSize * 1.4;
  let y = 1190 - (50 + 34 + headH + 24 + sumH);

  chip(ctx, `Top story · ${story.category}`, PAD, y, color);
  y += 50 + 34;
  ctx.fillStyle = "#fff";
  ctx.font = font("bold", head.size);
  drawLines(ctx, head.lines, PAD, y + head.size * 0.92, head.size, 1.14);
  y += headH + 24;
  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.font = font("regular", sumSize);
  drawLines(ctx, sum, PAD, y + sumSize * 0.95, sumSize, 1.4);

  credit(ctx, photo?.credit, W - PAD, 1212);

  // footer strip
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillRect(PAD, 1232, maxW, 2);
  ctx.font = font("bold", 28);
  ctx.fillStyle = "#fff";
  ctx.fillText(`LAST ${config.windowHours} HOURS · TOP ${meta.total} TN NEWS`, PAD, 1292);
  ctx.textAlign = "right";
  ctx.fillStyle = C.yellow;
  ctx.fillText("SWIPE  →", W - PAD, 1292);
  ctx.textAlign = "left";

  return cv.encode("jpeg", 90);
}

async function storySlide(story, photo, index, meta) {
  const cv = createCanvas(W, H);
  const ctx = cv.getContext("2d");
  const color = CATEGORY_COLORS[story.category] ?? C.red;
  const photoH = 700;

  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  if (photo) drawImageCover(ctx, await loadImage(photo.buffer), 0, 0, W, photoH + 40);
  else fallbackBackground(ctx, 0, 0, W, photoH + 40, color, story.category);

  const g = ctx.createLinearGradient(0, 0, 0, 240);
  g.addColorStop(0, "rgba(6,12,26,0.65)");
  g.addColorStop(1, "rgba(6,12,26,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, 240);

  // number badge
  ctx.fillStyle = C.red;
  roundRect(ctx, PAD, PAD, 118, 118, 22);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = font("bold", 62);
  ctx.textAlign = "center";
  ctx.fillText(String(index + 1).padStart(2, "0"), PAD + 59, PAD + 82);
  ctx.textAlign = "left";

  // small wordmark top right
  ctx.font = font("bold", 24);
  const [first, ...rest] = config.brand.split(/\s+/);
  const wmW = ctx.measureText(first).width + 20 + 10 + ctx.measureText(rest.join(" ")).width;
  wordmark(ctx, W - PAD - wmW * 0.88, PAD + 30, 0.72);

  credit(ctx, photo?.credit, W - PAD, photoH - 22);

  // paper panel with rounded top
  ctx.fillStyle = C.paper;
  roundRect(ctx, 0, photoH, W, H - photoH + 40, 40);
  ctx.fill();

  chip(ctx, story.category, PAD, photoH - 28, color, "#fff", 26);

  const maxW = W - PAD * 2;
  let y = photoH + 70;
  const head = fitText(ctx, story.headline, "bold", [60, 56, 52, 48, 44], maxW, 3);
  ctx.fillStyle = C.ink;
  ctx.font = font("bold", head.size);
  y = drawLines(ctx, head.lines, PAD, y + head.size, head.size, 1.16) - head.size * 0.16;

  if (story.key_fact) {
    y += 30;
    ctx.fillStyle = color;
    ctx.fillRect(PAD, y, 8, 44);
    ctx.font = font("semi", 30);
    const kf = ellipsize(ctx, wrapLines(ctx, story.key_fact, maxW - 30), 1, maxW - 30);
    ctx.fillText(kf[0], PAD + 26, y + 33);
    y += 44;
  }

  // summary fills the space left above the footer
  y += 30;
  const footerY = 1262;
  const lh = 1.4;
  let sumSize = 32;
  let sum;
  for (const size of [32, 30, 28, 26]) {
    sumSize = size;
    const room = Math.max(1, Math.floor((footerY - 24 - y) / (size * lh)));
    ctx.font = font("regular", size);
    const lines = wrapLines(ctx, story.summary, maxW);
    sum = ellipsize(ctx, lines, Math.min(room, 6), maxW);
    if (lines.length <= room) break;
  }
  ctx.fillStyle = C.gray;
  drawLines(ctx, sum, PAD, y + sumSize, sumSize, lh);

  // footer
  ctx.fillStyle = C.line;
  ctx.fillRect(PAD, footerY, maxW, 2);
  ctx.font = font("semi", 24);
  ctx.fillStyle = C.gray;
  const src = ellipsize(ctx, [`Source: ${story.source_name}`], 1, 410)[0];
  ctx.fillText(src, PAD, footerY + 52);
  ctx.textAlign = "right";
  ctx.font = font("bold", 26);
  ctx.fillStyle = C.ink;
  ctx.fillText(`${index + 1} / ${meta.total}`, W - PAD, footerY + 52);
  ctx.font = font("semi", 22);
  ctx.fillStyle = C.gray;
  ctx.textAlign = "center";
  ctx.fillText(config.handle, W / 2 + 40, footerY + 52);
  ctx.textAlign = "left";

  return cv.encode("jpeg", 90);
}

// Instagram Story (1080×1920) announcing the new edition. Instagram covers roughly the top 250 px
// (progress bar, name) and bottom 250 px (reply bar), so all content sits between those.
export async function renderStory(edition, photos, meta) {
  registerFonts();
  const SW = 1080;
  const SH = 1920;
  const cv = createCanvas(SW, SH);
  const ctx = cv.getContext("2d");
  const [top, ...rest] = edition.stories;
  const color = CATEGORY_COLORS[top.category] ?? C.red;

  // background: navy with a soft red glow behind the card
  let g = ctx.createLinearGradient(0, 0, 0, SH);
  g.addColorStop(0, "#0E2147");
  g.addColorStop(1, "#060F22");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SW, SH);
  g = ctx.createRadialGradient(SW / 2, 760, 40, SW / 2, 760, 700);
  g.addColorStop(0, "rgba(225,29,46,0.28)");
  g.addColorStop(1, "rgba(225,29,46,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SW, SH);

  // header: wordmark, edition and date (centred)
  ctx.font = font("bold", Math.round(34 * 1.5));
  const [first, ...restWords] = config.brand.split(/\s+/);
  const wmW = ctx.measureText(first).width + 28 * 1.5 + 12 * 1.5 + ctx.measureText(restWords.join(" ")).width;
  wordmark(ctx, (SW - wmW) / 2, 270, 1.5);
  ctx.textAlign = "center";
  ctx.font = font("bold", 34);
  ctx.fillStyle = C.yellow;
  ctx.fillText(`${meta.editionLabel.toUpperCase()} IS LIVE`, SW / 2, 410);
  ctx.font = font("semi", 30);
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillText(meta.dateLabel, SW / 2, 458);
  ctx.textAlign = "left";

  // top-story card with its photo
  const cx = 60;
  const cy = 490;
  const cw = SW - 120;
  const ch = 600;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 12;
  roundRect(ctx, cx, cy, cw, ch, 36);
  ctx.fillStyle = C.navy;
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, cx, cy, cw, ch, 36);
  ctx.clip();
  if (photos[0]) drawImageCover(ctx, await loadImage(photos[0].buffer), cx, cy, cw, ch);
  else fallbackBackground(ctx, cx, cy, cw, ch, color, top.category);
  g = ctx.createLinearGradient(0, cy + ch * 0.3, 0, cy + ch);
  g.addColorStop(0, "rgba(6,12,26,0)");
  g.addColorStop(1, "rgba(6,12,26,0.95)");
  ctx.fillStyle = g;
  ctx.fillRect(cx, cy, cw, ch);
  ctx.restore();
  const pad = 44;
  const head = fitText(ctx, top.headline, "bold", [62, 56, 50, 46], cw - pad * 2, 3);
  const headH = head.lines.length * head.size * 1.14;
  const headTop = cy + ch - pad - headH;
  chip(ctx, `Top story · ${top.category}`, cx + pad, headTop - 74, color, "#fff", 26);
  ctx.fillStyle = "#fff";
  ctx.font = font("bold", head.size);
  drawLines(ctx, head.lines, cx + pad, headTop + head.size * 0.92, head.size, 1.14);
  if (photos[0]?.credit) credit(ctx, photos[0].credit, cx + cw - 28, cy + 44);

  // "also in this edition": as many of the next headlines as fit above the button
  const ctaY = 1560;
  let y = cy + ch + 86;
  ctx.font = font("bold", 30);
  ctx.fillStyle = C.yellow;
  ctx.letterSpacing = "3px";
  ctx.fillText("ALSO IN THIS EDITION", cx, y);
  ctx.letterSpacing = "0px";
  y += 34;
  const listW = cw - 90;
  for (const [i, s] of rest.slice(0, 4).entries()) {
    const line = fitText(ctx, s.headline, "semi", [31, 29, 27], listW, 2);
    const rowH = Math.max(72, line.lines.length * line.size * 1.22 + 26);
    if (y + rowH > ctaY - 20) break;
    ctx.fillStyle = C.red;
    roundRect(ctx, cx, y + 16, 64, 52, 12);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = font("bold", 30);
    ctx.textAlign = "center";
    ctx.fillText(String(i + 2).padStart(2, "0"), cx + 32, y + 53);
    ctx.textAlign = "left";
    ctx.font = font("semi", line.size);
    ctx.fillStyle = "#fff";
    drawLines(ctx, line.lines, cx + 90, y + 16 + line.size * 1.05, line.size, 1.25);
    y += rowH;
  }

  // call to action, kept above Instagram's reply bar
  const cta = `SEE ALL ${edition.stories.length} ON OUR LATEST POST`;
  ctx.font = font("bold", 32);
  const ctaW = ctx.measureText(cta).width + 120;
  ctx.fillStyle = C.yellow;
  roundRect(ctx, (SW - ctaW) / 2, ctaY, ctaW, 84, 42);
  ctx.fill();
  ctx.fillStyle = C.navy;
  ctx.textAlign = "center";
  ctx.fillText(`${cta}  →`, SW / 2, ctaY + 54);
  ctx.font = font("semi", 28);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText(`Tap ${config.handle} above · full stories: link in bio`, SW / 2, ctaY + 128);
  ctx.textAlign = "left";

  return cv.encode("jpeg", 92);
}

export async function renderSlides(edition, photos, meta) {
  registerFonts();
  const m = { ...meta, total: edition.stories.length };
  const slides = [];
  for (let i = 0; i < edition.stories.length; i++) {
    slides.push(i === 0 ? await cover(edition.stories[0], photos[0], m) : await storySlide(edition.stories[i], photos[i], i, m));
  }
  return slides;
}
