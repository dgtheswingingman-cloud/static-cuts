// Daily social posts: the picture sizes, and how many pictures each kind has.
//   ig  Instagram post (also shared to the story from the app)
//   tt  TikTok photo (portrait)
//   x   X
export type SocialFormat = "ig" | "tt" | "x";
export const SOCIAL_SIZE: Record<SocialFormat, [number, number]> = { ig: [1080, 1350], tt: [1080, 1920], x: [1600, 900] };
export const SOCIAL_SLIDES: Record<string, Record<SocialFormat, number>> = {
  song_of_day: { ig: 1, tt: 1, x: 1 },
  on_this_day: { ig: 1, tt: 1, x: 1 },
  album_of_week: { ig: 2, tt: 2, x: 1 },
  monthly: { ig: 3, tt: 3, x: 1 },
};

// Bump when the pictures' design changes, so browsers and the CDN fetch the new ones.
export const SOCIAL_SLIDE_VERSION = "6";
