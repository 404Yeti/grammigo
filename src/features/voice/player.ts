import { isMigoMuted } from "./preference";

let player: HTMLAudioElement | undefined;
let owner: symbol | undefined;
function sharedPlayer() { return player ??= new Audio(); }
export function stopMigoAudio(token: symbol) {
  if (owner !== token) return;
  player?.pause();
  owner = undefined;
}
export function takeMigoAudio(token: symbol, url: string): HTMLAudioElement {
  const audio = sharedPlayer();
  audio.pause();
  owner = token;
  audio.onended = null;
  audio.onerror = null;
  audio.src = url;
  return audio;
}
/** Unlock the same element during Check/Finish's gesture. A denied play remains harmless. */
export function primeMigoAudio() {
  if (process.env.NEXT_PUBLIC_MIGO_VOICE !== "true" || isMigoMuted()) return;
  try {
    const audio = sharedPlayer();
    audio.pause();
    owner = undefined;
    audio.onended = null;
    audio.onerror = null;
    // Tiny silent PCM WAV; never a provider request or learner recording.
    const silence = "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQIAAACAgA==";
    audio.src = silence;
    void audio.play().then(() => { if (!owner && audio.src === silence) audio.pause(); }).catch(() => {});
  } catch { /* optional playback: replay remains available */ }
}
