// Daily social posts: how many pictures each kind has on each platform.
export type SocialFormat = "ig" | "story" | "x";
export const SOCIAL_SIZE: Record<SocialFormat, [number, number]> = { ig: [1080, 1350], story: [1080, 1920], x: [1600, 900] };
export const SOCIAL_SLIDES: Record<string, Record<SocialFormat, number>> = {
  song_of_day: { ig: 1, story: 1, x: 1 },
  on_this_day: { ig: 1, story: 1, x: 1 },
  album_of_week: { ig: 2, story: 2, x: 1 },
  monthly: { ig: 3, story: 3, x: 1 },
};
