// Smaller pictures for thumbnails. Deezer and Spotify serve the same picture
// at other sizes from a slightly different link; Deezer covers are stored at
// 1000 x 1000 (~200 KB each) but mostly shown at 40-80 px. Anything else is
// returned unchanged.
export function thumb<T extends string | null | undefined>(url: T, size = 250): T {
  if (!url) return url;
  let u: string = url;
  if (u.includes("dzcdn.net/images/")) u = u.replace(/\/(\d+)x(\d+)-/, `/${size}x${size}-`);
  else if (u.includes("i.scdn.co/image/") && size <= 300) {
    u = u.replace("ab67616d0000b273", "ab67616d00001e02") // album 640 -> 300
         .replace("ab6761610000e5eb", "ab67616100005174"); // artist 640 -> 320
  }
  return u as T;
}
