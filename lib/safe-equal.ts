// Porównanie stringów w czasie stałym (odporne na timing attack). Czysty JS,
// bez importów node:crypto — działa też w runtime'ie Edge (middleware).
// Uwaga: różnica długości jest wykrywalna czasowo (akceptowalne dla sekretów
// o nieujawnionej długości), ale samo porównanie bajtów nie zwiera obwodu.
export function safeEqual(a: string, b: string): boolean {
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  // XOR po max długości, żeby nie zwierać na pierwszej różnicy.
  const len = Math.max(ae.length, be.length);
  let diff = ae.length ^ be.length;
  for (let i = 0; i < len; i++) {
    diff |= (ae[i] ?? 0) ^ (be[i] ?? 0);
  }
  return diff === 0;
}
