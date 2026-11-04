// Story pictures (1080 x 1920, Instagram / TikTok / Snapchat size), drawn in
// the browser in the Static Cuts style: dark, grainy, big type. Shared with
// the phone's share sheet when it can take pictures, otherwise downloaded.

export type Story = {
  kicker: string; // small line at the top, e.g. "LEAKED · PLAYBOI CARTI"
  title: string; // the big words
  subtitle?: string;
  lines?: string[]; // a short list under the title
  bigNumber?: string; // a huge number instead of a picture
  imageUrl?: string | null; // cover art or artist photo
  round?: boolean; // round picture (artists)
  footer?: string; // defaults to the site address
};

const W = 1080, H = 1920;

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
    setTimeout(() => resolve(null), 6000);
  });
}

// Words that don't fit get wrapped onto more lines (at most maxLines).
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else line = test;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(" ") !== lines.join(" ")) {
    let last = lines[maxLines - 1];
    while (ctx.measureText(last + "…").width > maxWidth && last.length > 1) last = last.slice(0, -1);
    lines[maxLines - 1] = last + "…";
  }
  return lines;
}

export async function drawStory(s: Story): Promise<Blob | null> {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) return null;

  // Background: near black with a soft glow and film grain.
  ctx.fillStyle = "#0b0b0c";
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H * 0.38, 40, W / 2, H * 0.38, 900);
  glow.addColorStop(0, "rgba(255,255,255,0.10)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  const grain = ctx.createImageData(W, H);
  for (let i = 0; i < grain.data.length; i += 4) {
    const v = Math.random() * 255;
    grain.data[i] = grain.data[i + 1] = grain.data[i + 2] = v;
    grain.data[i + 3] = 14;
  }
  const grainCanvas = document.createElement("canvas");
  grainCanvas.width = W; grainCanvas.height = H;
  grainCanvas.getContext("2d")?.putImageData(grain, 0, 0);
  ctx.drawImage(grainCanvas, 0, 0);
  // Scan lines.
  ctx.fillStyle = "rgba(255,255,255,0.025)";
  for (let y = 0; y < H; y += 6) ctx.fillRect(0, y, W, 2);

  const bone = "#ededed", smoke = "#8a8a8a";
  const mono = "ui-monospace, 'SF Mono', Menlo, monospace";
  const display = "Anton, Impact, 'Arial Narrow', sans-serif";

  // Top: site name and the kicker.
  ctx.fillStyle = bone;
  ctx.font = `600 44px ${mono}`;
  ctx.textAlign = "left";
  ctx.fillText("STATIC CUTS//", 80, 150);
  ctx.fillStyle = smoke;
  ctx.font = `32px ${mono}`;
  ctx.fillText(s.kicker.toUpperCase().slice(0, 48), 80, 205);

  let y = 330;
  // Picture or big number.
  if (s.imageUrl) {
    const img = await loadImage(s.imageUrl);
    if (img) {
      const size = 760, x = (W - size) / 2;
      ctx.save();
      if (s.round) { ctx.beginPath(); ctx.arc(W / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.clip(); }
      const scale = Math.max(size / img.width, size / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      try { ctx.drawImage(img, x + (size - dw) / 2, y + (size - dh) / 2, dw, dh); } catch { /* blocked picture: skip */ }
      ctx.restore();
      if (!s.round) { ctx.strokeStyle = "rgba(237,237,237,0.25)"; ctx.lineWidth = 2; ctx.strokeRect(x, y, size, size); }
      y += size + 110;
    } else y += 120;
  } else if (s.bigNumber) {
    ctx.fillStyle = bone;
    ctx.textAlign = "center";
    let size = 420;
    ctx.font = `${size}px ${display}`;
    while (ctx.measureText(s.bigNumber).width > W - 160 && size > 120) { size -= 20; ctx.font = `${size}px ${display}`; }
    ctx.fillText(s.bigNumber, W / 2, y + size * 0.85);
    y += size + 80;
    ctx.textAlign = "left";
  } else y += 120;

  // Title.
  ctx.fillStyle = bone;
  ctx.textAlign = "center";
  let tsize = 120;
  ctx.font = `${tsize}px ${display}`;
  let tl = wrap(ctx, s.title.toUpperCase(), W - 160, 3);
  while (tl.length > 2 && tsize > 80) { tsize -= 10; ctx.font = `${tsize}px ${display}`; tl = wrap(ctx, s.title.toUpperCase(), W - 160, 3); }
  for (const l of tl) { ctx.fillText(l, W / 2, y); y += tsize * 1.05; }

  if (s.subtitle) {
    ctx.fillStyle = smoke;
    ctx.font = `40px ${mono}`;
    for (const l of wrap(ctx, s.subtitle, W - 200, 2)) { ctx.fillText(l, W / 2, y + 10); y += 56; }
  }
  if (s.lines?.length) {
    y += 40;
    ctx.font = `44px ${mono}`;
    for (const l of s.lines.slice(0, 6)) {
      ctx.fillStyle = bone;
      ctx.fillText(wrap(ctx, l, W - 200, 1)[0] ?? "", W / 2, y);
      y += 70;
    }
  }

  // Footer.
  ctx.fillStyle = smoke;
  ctx.font = `34px ${mono}`;
  ctx.fillText(s.footer ?? "static-cuts.com", W / 2, H - 110);

  return new Promise((resolve) => c.toBlob((b) => resolve(b), "image/png"));
}

// Share the picture (phones) or download it (computers).
export async function shareStory(s: Story, fileName: string) {
  const blob = await drawStory(s);
  if (!blob) return false;
  const file = new File([blob], `${fileName}.png`, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: s.title }); return true; } catch { /* closed the sheet */ return false; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${fileName}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return true;
}
