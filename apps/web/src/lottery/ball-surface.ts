/** Equirectangular atlas projection onto two opposite spherical medallions.
 * Positions use Three's SphereGeometry UV convention. This paints the sphere
 * itself, so the marking shares its curvature, normals, lighting and rotation.
 */
export function ballMarkProjection(
  u: number,
  v: number,
): { x: number; y: number } | null {
  const theta = v * Math.PI,
    phi = u * Math.PI * 2;
  const x = -Math.cos(phi) * Math.sin(theta),
    y = Math.cos(theta),
    z = Math.sin(phi) * Math.sin(theta);
  const edge = 0.64;
  if (Math.abs(z) < edge) return null;
  const radius = Math.sqrt(1 - edge * edge);
  return {
    x: 0.5 + (z >= 0 ? x : -x) / (2 * radius),
    y: 0.5 - y / (2 * radius),
  };
}

const WIDTH = 512,
  HEIGHT = 256,
  STAMP = 256;
let projection: Int32Array | null = null;
function projectionMap() {
  if (projection) return projection;
  projection = new Int32Array(WIDTH * HEIGHT).fill(-1);
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      const p = ballMarkProjection((x + 0.5) / WIDTH, (y + 0.5) / HEIGHT);
      if (p)
        projection[y * WIDTH + x] =
          (Math.min(STAMP - 1, Math.max(0, Math.floor(p.y * STAMP))) * STAMP +
            Math.min(STAMP - 1, Math.max(0, Math.floor(p.x * STAMP)))) *
          4;
    }
  return projection;
}

export function paintBallSurface(
  surface: HTMLCanvasElement,
  color: string,
  ticker: string,
  image?: HTMLImageElement,
) {
  surface.width = WIDTH;
  surface.height = HEIGHT;
  const context = surface.getContext("2d")!;
  context.fillStyle = color;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  const stamp = document.createElement("canvas");
  stamp.width = stamp.height = STAMP;
  const ink = stamp.getContext("2d")!;
  ink.fillStyle = "#fff9e9";
  ink.fillRect(0, 0, STAMP, STAMP);
  ink.fillStyle = "#282135";
  ink.textAlign = "center";
  ink.textBaseline = "middle";
  if (image) {
    ink.save();
    ink.beginPath();
    ink.arc(128, 65, 31, 0, Math.PI * 2);
    ink.clip();
    const edge = Math.min(image.naturalWidth, image.naturalHeight);
    ink.drawImage(
      image,
      (image.naturalWidth - edge) / 2,
      (image.naturalHeight - edge) / 2,
      edge,
      edge,
      97,
      34,
      62,
      62,
    );
    ink.restore();
  } else {
    ink.font = "800 40px sans-serif";
    ink.fillText(
      ticker.replace(/^\$/, "").slice(0, 2).toUpperCase(),
      128,
      65,
      155,
    );
  }
  ink.font = `900 ${ticker.length > 10 ? 35 : ticker.length > 7 ? 46 : 62}px sans-serif`;
  ink.fillText(ticker, 128, 141, 225);
  const pixels = context.getImageData(0, 0, WIDTH, HEIGHT),
    badge = ink.getImageData(0, 0, STAMP, STAMP).data,
    lookup = projectionMap();
  for (let i = 0; i < lookup.length; i++) {
    const b = lookup[i];
    if (b < 0) continue;
    const t = i * 4;
    pixels.data[t] = badge[b];
    pixels.data[t + 1] = badge[b + 1];
    pixels.data[t + 2] = badge[b + 2];
    pixels.data[t + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
}
