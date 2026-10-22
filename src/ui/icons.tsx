// Simple line icons (no emoji), matching Orange's iconography style.
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const YuzuMark = ({ size = 28 }: { size?: number }) => (
  <svg className="yuzu-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden>
    <circle cx="32" cy="34" r="24" fill="#f2d34b" />
    <circle cx="32" cy="34" r="24" fill="none" stroke="#c9a92c" strokeWidth="2" />
    <path d="M32 10 c-2-6 4-9 7-6 c-4 0-5 3-7 6z" fill="#7ea33c" />
    <circle cx="24" cy="28" r="1.6" fill="#d6b83a" /><circle cx="40" cy="26" r="1.6" fill="#d6b83a" /><circle cx="36" cy="44" r="1.6" fill="#d6b83a" /><circle cx="22" cy="42" r="1.6" fill="#d6b83a" />
  </svg>
);
export const IconToday = () => (<svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>);
export const IconLibrary = () => (<svg viewBox="0 0 24 24" {...P}><path d="M4 5h5l2 2h9v11H4z" /><path d="M4 10h16" /></svg>);
export const IconProgress = () => (<svg viewBox="0 0 24 24" {...P}><path d="M4 19V10M10 19V5M16 19v-7M22 19H2" /></svg>);
export const IconSettings = () => (<svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a7.8 7.8 0 0 0 .1-6l-2-.6-.7-1.7 1-1.8a8 8 0 0 0-5.2-3l-1 1.8h-1.8l-1-1.8a8 8 0 0 0-5.2 3l1 1.8-.7 1.7-2 .6a7.8 7.8 0 0 0 .1 6l2 .6.7 1.7-1 1.8a8 8 0 0 0 5.2 3l1-1.8h1.8l1 1.8a8 8 0 0 0 5.2-3l-1-1.8.7-1.7z" /></svg>);
export const IconClose = () => (<svg viewBox="0 0 24 24" {...P}><path d="M6 6l12 12M18 6L6 18" /></svg>);
export const IconUndo = () => (<svg viewBox="0 0 24 24" {...P}><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>);
export const IconFlag = () => (<svg viewBox="0 0 24 24" {...P}><path d="M5 21V4h11l-2 4 2 4H5" /></svg>);
export const IconPause = () => (<svg viewBox="0 0 24 24" {...P}><path d="M8 5v14M16 5v14" /></svg>);
export const IconChevron = () => (<svg viewBox="0 0 24 24" width="18" height="18" {...P}><path d="M9 6l6 6-6 6" /></svg>);
export const IconPlay = () => (<svg viewBox="0 0 24 24" {...P}><path d="M7 4l12 8-12 8z" /></svg>);
export const IconFlame = () => (<svg viewBox="0 0 24 24" {...P}><path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z" /></svg>);
export const IconInfo = () => (<svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>);
export const IconPin = () => (<svg viewBox="0 0 24 24" {...P}><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3z" /><path d="M12 15v6" /></svg>);
export const IconMore = () => (<svg viewBox="0 0 24 24" {...P}><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></svg>);
export const IconEdit = () => (<svg viewBox="0 0 24 24" {...P}><path d="M4 20h4l10-10-4-4L4 16z" /><path d="M12 8l4 4" /></svg>);
