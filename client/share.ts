/**
 * Share image: draw the layout from export.ts onto a canvas and hand it to
 * the clipboard or a download. This is the only file that touches the DOM
 * for sharing.
 */

import { FONT_SANS, IMAGE, layoutShareImage, type ShareInput, type ShareLayout } from "./export";

/** Ask the browser for the weights the image uses, so the first draw does not fall back. */
export function warmShareFonts(): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return Promise.resolve();
  const loads = [`600 34px ${FONT_SANS}`, `500 18px ${FONT_SANS}`, `400 20px ${FONT_SANS}`].map((font) => document.fonts.load(font).then(() => undefined));
  const timeout = new Promise<void>((resolve) => { setTimeout(resolve, 3000); });
  return Promise.race([Promise.all(loads).then(() => undefined), timeout]).catch(() => undefined);
}

export function renderShareImage(input: ShareInput, scale = 2): Promise<Blob> {
  return warmShareFonts().then(() => new Promise<Blob>((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = IMAGE.width * scale;
    canvas.height = IMAGE.height * scale;
    const context = canvas.getContext("2d");
    if (!context) { reject(new Error("Canvas is not available")); return; }
    context.scale(scale, scale);
    const measure = (text: string, font: string) => { context.font = font; return context.measureText(text).width; };
    drawShareImage(context, layoutShareImage(input, measure));
    canvas.toBlob((blob) => { if (blob) resolve(blob); else reject(new Error("Could not encode the image")); }, "image/png");
  }));
}

function text(context: CanvasRenderingContext2D, item: { text: string; x: number; y: number; font: string; color: string; align: "left" | "right" | "center" }): void {
  context.font = item.font;
  context.fillStyle = item.color;
  context.textAlign = item.align;
  context.textBaseline = "alphabetic";
  context.fillText(item.text, item.x, item.y);
}

export function drawShareImage(context: CanvasRenderingContext2D, layout: ShareLayout): void {
  context.fillStyle = layout.background;
  context.fillRect(0, 0, layout.width, layout.height);

  // Title block.
  layout.title.lines.forEach((line, index) => text(context, { text: line, x: layout.title.x, y: layout.title.y + index * layout.title.lineHeight, font: layout.title.font, color: layout.title.color, align: "left" }));
  text(context, layout.subtitle);
  for (const item of layout.legend) {
    context.strokeStyle = item.color; context.lineWidth = 3; context.setLineDash(item.dash);
    context.beginPath(); context.moveTo(item.x, item.y - 6); context.lineTo(item.x + 26, item.y - 6); context.stroke();
    context.setLineDash([]);
    text(context, { text: item.text, x: item.x + 34, y: item.y, font: item.font, color: "#1f2933", align: "left" });
  }

  const { plot } = layout;
  // Bands under everything.
  for (const band of layout.bands) {
    context.globalAlpha = band.alpha; context.fillStyle = band.fill;
    context.fillRect(band.x1, plot.y, band.x2 - band.x1, plot.h);
    context.globalAlpha = 1;
    if (band.label) text(context, { text: band.label, x: (band.x1 + band.x2) / 2, y: plot.y + 18, font: `400 14px ${FONT_SANS}`, color: band.fill, align: "center" });
  }
  // Grid and axis labels.
  context.strokeStyle = "#e2e8ee"; context.lineWidth = 1; context.setLineDash([]);
  for (const tick of layout.yTicks) {
    context.beginPath(); context.moveTo(plot.x, tick.y); context.lineTo(plot.x + plot.w, tick.y); context.stroke();
    text(context, { text: tick.label, x: plot.x - 12, y: tick.y + 6, font: `400 17px ${FONT_SANS}`, color: "#5b6b7a", align: "right" });
  }
  for (const line of layout.refLines) {
    context.strokeStyle = "#7f8d9a"; context.beginPath(); context.moveTo(plot.x, line.y); context.lineTo(plot.x + plot.w, line.y); context.stroke();
  }
  context.strokeStyle = "#7f8d9a";
  context.beginPath(); context.moveTo(plot.x, plot.y + plot.h); context.lineTo(plot.x + plot.w, plot.y + plot.h); context.stroke();
  for (const tick of layout.xTicks) {
    context.beginPath(); context.moveTo(tick.x, plot.y + plot.h); context.lineTo(tick.x, plot.y + plot.h + 6); context.stroke();
    text(context, { text: tick.label, x: tick.x, y: plot.y + plot.h + 28, font: `400 17px ${FONT_SANS}`, color: "#5b6b7a", align: "center" });
  }
  // Series.
  context.lineJoin = "round"; context.lineCap = "round";
  for (const line of layout.lines) {
    if (line.points.length === 0) continue;
    context.strokeStyle = line.color; context.lineWidth = line.width; context.setLineDash(line.dash);
    context.beginPath();
    line.points.forEach(([x, y], index) => { if (index === 0) context.moveTo(x, y); else context.lineTo(x, y); });
    context.stroke();
    context.setLineDash([]);
    const last = line.points[line.points.length - 1];
    if (last) { context.fillStyle = line.color; context.beginPath(); context.arc(last[0], last[1], 4.5, 0, Math.PI * 2); context.fill(); }
  }
  for (const label of layout.endLabels) text(context, { ...label, y: label.y + 6 });
  for (const note of layout.notes) text(context, note);

  // Footer: brand mark, name, source, date.
  const { mark } = layout.footer;
  context.fillStyle = "#c0392b";
  context.beginPath();
  context.roundRect(mark.x, mark.y, mark.size, mark.size, 5);
  context.fill();
  text(context, { text: "数", x: mark.x + mark.size / 2, y: mark.y + mark.size - 6, font: `700 15px ${FONT_SANS}`, color: "#ffffff", align: "center" });
  text(context, layout.footer.brand);
  text(context, layout.footer.source);
  text(context, layout.footer.date);
}

export function canCopyImage(): boolean {
  return typeof ClipboardItem !== "undefined" && typeof navigator !== "undefined" && typeof navigator.clipboard?.write === "function";
}

/**
 * Copy a PNG. Takes the promise, not the blob: Safari only honours the user
 * gesture when `clipboard.write` is called synchronously inside the click
 * handler, and it accepts a promise for the item's data.
 */
export function copyImage(image: Promise<Blob>): Promise<void> {
  return navigator.clipboard.write([new ClipboardItem({ "image/png": image })]);
}

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  URL.revokeObjectURL(url);
}

export function shareFileName(keys: string[], extension: string): string {
  return `econstats-china-${keys.map((key) => key.replace(/[^a-z0-9_@-]/gi, "")).join("-")}.${extension}`;
}
