// Card sounds: one shared <audio> element, tap-to-play buttons inside the card's shadow root,
// and Anki-style autoplay (question sounds on the front; on the back only the answer's own sounds).
let player: HTMLAudioElement | null = null;
let queue: string[] = [];
let current: HTMLElement | null = null;

function el() {
  if (!player) {
    player = new Audio(); player.preload = "auto";
    player.addEventListener("ended", () => { mark(null); playNext(); });
    player.addEventListener("error", () => { mark(null); playNext(); });
  }
  return player;
}
function mark(b: HTMLElement | null) { current?.classList.remove("playing"); current = b; b?.classList.add("playing"); }
function playNext() {
  const next = queue.shift(); if (!next) return;
  const a = el(); a.src = next; a.play().catch(() => { /* autoplay blocked until the first tap: the buttons still work */ });
}

export function stopSounds() { queue = []; if (player) { player.pause(); player.removeAttribute("src"); } mark(null); }

/** Play these sound URLs one after another (replacing what is playing). */
export function playSounds(urls: string[], first?: HTMLElement) { stopSounds(); queue = [...urls]; playNext(); if (first) mark(first); }

/** Wire the play buttons in a rendered card; returns the URLs autoplay would use for this side. */
export function wireSounds(root: ShadowRoot, side: "front" | "back"): string[] {
  const buttons = [...root.querySelectorAll<HTMLElement>("button.yz-sound[data-src]")];
  for (const b of buttons) b.addEventListener("click", (e) => { e.stopPropagation(); playSounds([b.dataset.src!], b); });
  const answer = root.querySelector("#answer");
  const own = side === "back" && answer ? buttons.filter((b) => answer.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) : buttons;
  return own.map((b) => b.dataset.src!);
}

/** All sound URLs on the card (for "replay"). */
export function cardSounds(root: ShadowRoot | null | undefined): string[] {
  return root ? [...root.querySelectorAll<HTMLElement>("button.yz-sound[data-src]")].map((b) => b.dataset.src!) : [];
}
