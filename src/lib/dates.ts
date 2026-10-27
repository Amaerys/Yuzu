// Dates are always dd/mm/yyyy (the user's standing preference), times 24-hour.
const p2 = (n: number) => String(n).padStart(2, "0");
export const fmtDate = (t: number | Date) => { const d = new Date(t); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`; };
export const fmtTime = (t: number | Date) => { const d = new Date(t); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
export const fmtDateTime = (t: number | Date) => `${fmtDate(t)} ${fmtTime(t)}`;
