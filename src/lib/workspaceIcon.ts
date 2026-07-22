const MAX_ICON_BYTES = 5 * 1024 * 1024;
const ACCEPTED_ICON_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function validateWorkspaceIcon(file: Pick<File, "size" | "type">) {
  if (!ACCEPTED_ICON_TYPES.has(file.type)) throw new Error("Choose a PNG, JPEG, or WebP image.");
  if (file.size > MAX_ICON_BYTES) throw new Error("Workspace icons must be 5 MB or smaller.");
}

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read that image."));
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That image could not be decoded."));
    image.src = source;
  });
}

export async function processWorkspaceIcon(file: File) {
  validateWorkspaceIcon(file);
  const image = await loadImage(await readFile(file));
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image processing is unavailable.");
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const sx = (image.naturalWidth - side) / 2;
  const sy = (image.naturalHeight - side) / 2;
  context.drawImage(image, sx, sy, side, side, 0, 0, 256, 256);
  return canvas.toDataURL("image/webp", 0.88);
}

export function workspaceInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "WS";
  return `${words[0]?.[0] ?? ""}${words.length > 1 ? words[words.length - 1]?.[0] ?? "" : words[0]?.[1] ?? ""}`.toUpperCase();
}
