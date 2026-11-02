// Shrink a picture in the browser before uploading: at most `max` pixels on
// the long side, saved as JPEG, kept under the covers bucket's 1 MB limit.
export async function shrinkImage(file: File, max = 1000): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That file isn't a picture we can read."));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of [0.88, 0.75, 0.6]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
      if (blob && blob.size < 1_000_000) return blob;
    }
    throw new Error("That picture is too big even after shrinking.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
