// Procedural SVG portraits: silhouette, hair, moustache, glasses, era clothing, rank insignia. No photos.
import type { CharacterInfo } from "../worker/protocol";

const SKIN = ["#f1d3b3", "#e0b48c", "#c68c5a", "#8d5a3a", "#5e3b28"];
const HAIR = ["#1d1d1d", "#3b2a1a", "#6b4a2b", "#8a8a8a", "#c9c9c9", "#a0522d"];
const SUIT = ["#2b2d42", "#3d405b", "#4a4e69", "#22333b", "#3a3a3a"];
const UNIFORM = ["#4b5320", "#556b2f", "#2f4f4f", "#3b3b5c"];

function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

export function Portrait({ c, size = 56, year = 1936 }: { c: CharacterInfo; size?: number; year?: number }) {
  const r = rand(c.seed + 1);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]!;
  const military = c.role === 3 || (c.mil > c.adm && c.mil > c.dip && r() < 0.5);
  const skin = pick(SKIN), hair = c.age > 62 ? HAIR[4]! : pick(HAIR), cloth = military ? pick(UNIFORM) : pick(SUIT);
  const bald = c.age > 50 && r() < 0.35, moustache = r() < (year < 1960 ? 0.5 : 0.2), glasses = r() < 0.3;
  const faceW = 15 + r() * 4, faceH = 19 + r() * 3;
  const tie = year < 1990 || r() < 0.5;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ background: "#d6cfc0", borderRadius: 4, flexShrink: 0 }} aria-label={`Portrait of ${c.name}`}>
      <rect x="0" y="0" width="64" height="64" fill={year < 1946 ? "#cdbb98" : year < 1990 ? "#b8c4c9" : "#c9d6df"} />
      <path d={`M8 64 Q10 44 32 42 Q54 44 56 64 Z`} fill={cloth} />
      {!military && <path d="M26 44 L32 54 L38 44 Z" fill="#f2f2f2" />}
      {!military && tie && <path d="M31 46 L33 46 L34 58 L32 61 L30 58 Z" fill={pick(["#7a1f1f", "#1f3a7a", "#333", "#5a4a1a"])} />}
      {military && <><rect x="14" y="47" width="8" height="3" fill="#d4af37" /><rect x="42" y="47" width="8" height="3" fill="#d4af37" />
        {Array.from({ length: Math.min(4, 1 + Math.round(c.mil / 2)) }, (_, i) => <circle key={i} cx={22 + i * 6} cy={56} r={1.6} fill="#d4af37" />)}</>}
      <rect x="28" y="36" width="8" height="8" fill={skin} />
      <ellipse cx="32" cy="27" rx={faceW / 2 + 4} ry={faceH / 2 + 3} fill={skin} />
      {!bald && <path d={`M${32 - faceW / 2 - 4} 24 Q32 ${8 + r() * 4} ${32 + faceW / 2 + 4} 24 Q${32 + faceW / 2} 16 32 15 Q${32 - faceW / 2} 16 ${32 - faceW / 2 - 4} 24 Z`} fill={hair} />}
      {military && <path d="M18 18 Q32 8 46 18 L47 21 L17 21 Z" fill={cloth} stroke="#222" strokeWidth="0.6" />}
      <circle cx="27.5" cy="27" r="1.3" fill="#222" /><circle cx="36.5" cy="27" r="1.3" fill="#222" />
      {glasses && <><circle cx="27.5" cy="27" r="3.2" fill="none" stroke="#333" strokeWidth="0.8" /><circle cx="36.5" cy="27" r="3.2" fill="none" stroke="#333" strokeWidth="0.8" /><line x1="30.7" y1="27" x2="33.3" y2="27" stroke="#333" strokeWidth="0.8" /></>}
      {moustache && <path d="M27 33 Q32 31 37 33 Q32 35 27 33 Z" fill={hair} />}
      <path d="M29 36 Q32 37.5 35 36" fill="none" stroke="#6b3b2a" strokeWidth="0.8" />
    </svg>
  );
}
