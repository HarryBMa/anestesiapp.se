/**
 * Videos offered in Lugn, after the generated scenes.
 *
 * To add one: put the file somewhere the browser can fetch it (a Supabase
 * Storage public bucket works well; small files can go in `public/lugn/`)
 * and add an entry here. Use footage you have the rights to, e.g. your own
 * recordings or clips under a licence that allows this use (Pexels, Pixabay).
 * Loop-friendly clips without sudden movement work best. MP4 (H.264) plays
 * everywhere, including iPad Safari.
 *
 * Staff can also play a file from the device with "Egen video", which never
 * leaves the device.
 */
export interface CalmVideo {
  title: { sv: string; en: string };
  src: string;
  /** Still image shown while the video loads. */
  poster?: string;
}

export const CALM_VIDEOS: CalmVideo[] = [
  // {
  //   title: { sv: 'Fjällsjö', en: 'Mountain lake' },
  //   src: 'https://<project>.supabase.co/storage/v1/object/public/lugn/fjallsjo.mp4',
  // },
];
