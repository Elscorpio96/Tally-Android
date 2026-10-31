// Calendar dates in the DEVICE's local time zone (YYYY-MM-DD).
// Fixes the old behaviour of `toISOString().slice(0,10)`, which is UTC and put
// sales made between 00:00 and 01:00 in Nigeria on the previous day.
export const localDateStr = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
