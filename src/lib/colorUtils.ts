import type { FilamentEntry, FilamentMatch, RGB } from '../types';

// [r, g, b, name, brand, material, searchUrl]
export const FILAMENTS: FilamentEntry[] = [
  // Hatchbox PLA
  [0,0,0,'Black','Hatchbox','PLA','https://www.amazon.com/s?k=hatchbox+pla+black'],
  [255,255,255,'White','Hatchbox','PLA','https://www.amazon.com/s?k=hatchbox+pla+white'],
  [200,30,30,'Red','Hatchbox','PLA','https://www.amazon.com/s?k=hatchbox+pla+red'],
  [30,80,200,'Blue','Hatchbox','PLA','https://www.amazon.com/s?k=hatchbox+pla+blue'],
  [30,160,60,'Green','Hatchbox','PLA','https://www.amazon.com/s?k=hatchbox+pla+green'],
  [240,200,20,'Yellow','Hatchbox','PLA','https://www.amazon.com/s?k=hatchbox+pla+yellow'],
  [240,130,20,'Orange','Hatchbox','PLA','https://www.amazon.com/s?k=hatchbox+pla+orange'],
  [140,60,180,'Purple','Hatchbox','PLA','https://www.amazon.com/s?k=hatchbox+pla+purple'],
  [255,110,160,'Pink','Hatchbox','PLA','https://www.amazon.com/s?k=hatchbox+pla+pink'],
  [128,128,128,'Gray','Hatchbox','PLA','https://www.amazon.com/s?k=hatchbox+pla+gray'],
  [190,190,190,'Silver','Hatchbox','PLA','https://www.amazon.com/s?k=hatchbox+pla+silver'],
  [210,175,55,'Gold','Hatchbox','PLA','https://www.amazon.com/s?k=hatchbox+pla+gold'],
  [100,60,30,'Brown','Hatchbox','PLA','https://www.amazon.com/s?k=hatchbox+pla+brown'],
  [0,150,200,'Cyan','Hatchbox','PLA','https://www.amazon.com/s?k=hatchbox+pla+cyan'],
  [40,40,80,'Navy','Hatchbox','PLA','https://www.amazon.com/s?k=hatchbox+pla+navy+blue'],
  // Prusament PLA
  [35,35,35,'Jet Black','Prusament','PLA','https://www.prusa3d.com/product/prusament-pla-jet-black/'],
  [60,60,60,'Galaxy Black','Prusament','PLA','https://www.prusa3d.com/product/prusament-pla-galaxy-black/'],
  [170,45,40,'Lipstick Red','Prusament','PLA','https://www.prusa3d.com/product/prusament-pla-lipstick-red/'],
  [200,75,30,'Prusa Orange','Prusament','PLA','https://www.prusa3d.com/product/prusament-pla-prusa-orange/'],
  [30,60,140,'Royal Blue','Prusament','PLA','https://www.prusa3d.com/product/prusament-pla-royal-blue/'],
  [80,165,80,'Jungle Green','Prusament','PLA','https://www.prusa3d.com/product/prusament-pla-jungle-green/'],
  [240,220,190,'Vanilla White','Prusament','PLA','https://www.prusa3d.com/product/prusament-pla-vanilla-white/'],
  [120,80,50,'Chocolate Brown','Prusament','PLA','https://www.prusa3d.com/product/prusament-pla-chocolate-brown/'],
  // eSUN PLA+
  [10,10,10,'Black','eSUN','PLA+','https://www.amazon.com/s?k=esun+pla%2B+black'],
  [250,250,250,'White','eSUN','PLA+','https://www.amazon.com/s?k=esun+pla%2B+white'],
  [180,35,35,'Fire Engine Red','eSUN','PLA+','https://www.amazon.com/s?k=esun+pla%2B+red'],
  [25,60,180,'Blue','eSUN','PLA+','https://www.amazon.com/s?k=esun+pla%2B+blue'],
  [100,200,100,'Peak Green','eSUN','PLA+','https://www.amazon.com/s?k=esun+pla%2B+green'],
  [255,210,30,'Yellow','eSUN','PLA+','https://www.amazon.com/s?k=esun+pla%2B+yellow'],
  [240,140,30,'Orange','eSUN','PLA+','https://www.amazon.com/s?k=esun+pla%2B+orange'],
  [100,50,160,'Purple','eSUN','PLA+','https://www.amazon.com/s?k=esun+pla%2B+purple'],
  [160,160,160,'Gray','eSUN','PLA+','https://www.amazon.com/s?k=esun+pla%2B+gray'],
  [80,155,200,'Light Blue','eSUN','PLA+','https://www.amazon.com/s?k=esun+pla%2B+light+blue'],
  [255,180,200,'Pink','eSUN','PLA+','https://www.amazon.com/s?k=esun+pla%2B+pink'],
  [200,160,100,'Skin / Bone White','eSUN','PLA+','https://www.amazon.com/s?k=esun+pla%2B+bone+white'],
  // Polymaker PolyLite PLA
  [15,15,15,'Black','Polymaker','PolyLite','https://www.amazon.com/s?k=polymaker+polylite+black'],
  [245,245,245,'White','Polymaker','PolyLite','https://www.amazon.com/s?k=polymaker+polylite+white'],
  [190,40,40,'Red','Polymaker','PolyLite','https://www.amazon.com/s?k=polymaker+polylite+red'],
  [50,90,170,'Blue','Polymaker','PolyLite','https://www.amazon.com/s?k=polymaker+polylite+blue'],
  [60,150,70,'Green','Polymaker','PolyLite','https://www.amazon.com/s?k=polymaker+polylite+green'],
  [240,200,50,'Yellow','Polymaker','PolyLite','https://www.amazon.com/s?k=polymaker+polylite+yellow'],
  [230,120,30,'Orange','Polymaker','PolyLite','https://www.amazon.com/s?k=polymaker+polylite+orange'],
  [120,50,150,'Purple','Polymaker','PolyLite','https://www.amazon.com/s?k=polymaker+polylite+purple'],
  [70,70,70,'Dark Gray','Polymaker','PolyLite','https://www.amazon.com/s?k=polymaker+polylite+gray'],
  [200,200,200,'Light Gray','Polymaker','PolyLite','https://www.amazon.com/s?k=polymaker+polylite+light+gray'],
  [120,180,220,'Ice Blue','Polymaker','PolyLite','https://www.amazon.com/s?k=polymaker+polylite+ice+blue'],
  [200,140,70,'Teal','Polymaker','PolyLite','https://www.amazon.com/s?k=polymaker+polylite+teal'],
  // Overture PLA
  [5,5,5,'Black','Overture','PLA','https://www.amazon.com/s?k=overture+pla+black'],
  [252,252,252,'White','Overture','PLA','https://www.amazon.com/s?k=overture+pla+white'],
  [185,25,25,'Red','Overture','PLA','https://www.amazon.com/s?k=overture+pla+red'],
  [35,75,190,'Blue','Overture','PLA','https://www.amazon.com/s?k=overture+pla+blue'],
  [220,190,30,'Yellow','Overture','PLA','https://www.amazon.com/s?k=overture+pla+yellow'],
  [50,140,55,'Green','Overture','PLA','https://www.amazon.com/s?k=overture+pla+green'],
  [235,130,25,'Orange','Overture','PLA','https://www.amazon.com/s?k=overture+pla+orange'],
  [100,40,140,'Purple','Overture','PLA','https://www.amazon.com/s?k=overture+pla+purple'],
  [180,135,60,'Gold','Overture','PLA','https://www.amazon.com/s?k=overture+pla+gold'],
  [90,60,35,'Brown','Overture','PLA','https://www.amazon.com/s?k=overture+pla+brown'],
  // Inland PLA
  [8,8,8,'Black','Inland','PLA','https://www.microcenter.com/search/search_results.aspx?Ntt=inland+pla+black'],
  [248,248,248,'White','Inland','PLA','https://www.microcenter.com/search/search_results.aspx?Ntt=inland+pla+white'],
  [195,30,30,'Red','Inland','PLA','https://www.microcenter.com/search/search_results.aspx?Ntt=inland+pla+red'],
  [40,70,175,'Blue','Inland','PLA','https://www.microcenter.com/search/search_results.aspx?Ntt=inland+pla+blue'],
  [55,150,65,'Green','Inland','PLA','https://www.microcenter.com/search/search_results.aspx?Ntt=inland+pla+green'],
  [245,200,25,'Yellow','Inland','PLA','https://www.microcenter.com/search/search_results.aspx?Ntt=inland+pla+yellow'],
  [245,135,25,'Orange','Inland','PLA','https://www.microcenter.com/search/search_results.aspx?Ntt=inland+pla+orange'],
  // Bambu Lab PLA Basic
  [20,20,20,'Black','Bambu Lab','PLA Basic','https://www.amazon.com/s?k=bambu+lab+pla+black'],
  [240,240,240,'White','Bambu Lab','PLA Basic','https://www.amazon.com/s?k=bambu+lab+pla+white'],
  [180,30,30,'Red','Bambu Lab','PLA Basic','https://www.amazon.com/s?k=bambu+lab+pla+red'],
  [30,80,190,'Blue','Bambu Lab','PLA Basic','https://www.amazon.com/s?k=bambu+lab+pla+blue'],
  [40,150,60,'Green','Bambu Lab','PLA Basic','https://www.amazon.com/s?k=bambu+lab+pla+green'],
  [250,210,30,'Yellow','Bambu Lab','PLA Basic','https://www.amazon.com/s?k=bambu+lab+pla+yellow'],
  [240,140,30,'Orange','Bambu Lab','PLA Basic','https://www.amazon.com/s?k=bambu+lab+pla+orange'],
  [115,55,155,'Purple','Bambu Lab','PLA Basic','https://www.amazon.com/s?k=bambu+lab+pla+purple'],
  [120,170,220,'Sky Blue','Bambu Lab','PLA Basic','https://www.amazon.com/s?k=bambu+lab+pla+sky+blue'],
  [255,160,180,'Sakura Pink','Bambu Lab','PLA Basic','https://www.amazon.com/s?k=bambu+lab+pla+sakura+pink'],
  [170,170,170,'Gray','Bambu Lab','PLA Basic','https://www.amazon.com/s?k=bambu+lab+pla+gray'],
  [210,180,60,'Gold','Bambu Lab','PLA Basic','https://www.amazon.com/s?k=bambu+lab+pla+gold'],
  [0,130,180,'Teal','Bambu Lab','PLA Basic','https://www.amazon.com/s?k=bambu+lab+pla+teal'],
  [140,50,50,'Maroon','Bambu Lab','PLA Basic','https://www.amazon.com/s?k=bambu+lab+pla+maroon'],
  [70,50,30,'Dark Brown','Bambu Lab','PLA Basic','https://www.amazon.com/s?k=bambu+lab+pla+brown'],
  // Creality Hyper PLA
  [12,12,12,'Black','Creality','Hyper PLA','https://www.amazon.com/s?k=creality+hyper+pla+black'],
  [245,245,245,'White','Creality','Hyper PLA','https://www.amazon.com/s?k=creality+hyper+pla+white'],
  [190,35,35,'Red','Creality','Hyper PLA','https://www.amazon.com/s?k=creality+hyper+pla+red'],
  [40,80,180,'Blue','Creality','Hyper PLA','https://www.amazon.com/s?k=creality+hyper+pla+blue'],
  [50,160,60,'Green','Creality','Hyper PLA','https://www.amazon.com/s?k=creality+hyper+pla+green'],
  // Silk/special filaments
  [210,175,90,'Silk Gold','Hatchbox','PLA Silk','https://www.amazon.com/s?k=hatchbox+silk+gold+pla'],
  [160,170,200,'Silk Silver','Hatchbox','PLA Silk','https://www.amazon.com/s?k=hatchbox+silk+silver+pla'],
  [200,100,60,'Silk Copper','Hatchbox','PLA Silk','https://www.amazon.com/s?k=hatchbox+silk+copper+pla'],
  [220,185,100,'Silk Gold','eSUN','PLA Silk','https://www.amazon.com/s?k=esun+silk+gold+pla'],
  [170,180,210,'Silk Silver','eSUN','PLA Silk','https://www.amazon.com/s?k=esun+silk+silver+pla'],
  [190,110,70,'Silk Copper','eSUN','PLA Silk','https://www.amazon.com/s?k=esun+silk+copper+pla'],
  [40,90,190,'Silk Blue','eSUN','PLA Silk','https://www.amazon.com/s?k=esun+silk+blue+pla'],
  [160,50,50,'Silk Red','eSUN','PLA Silk','https://www.amazon.com/s?k=esun+silk+red+pla'],
  [100,160,80,'Silk Green','eSUN','PLA Silk','https://www.amazon.com/s?k=esun+silk+green+pla'],
];

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  let rl = r / 255, gl = g / 255, bl = b / 255;
  rl = rl > 0.04045 ? Math.pow((rl + 0.055) / 1.055, 2.4) : rl / 12.92;
  gl = gl > 0.04045 ? Math.pow((gl + 0.055) / 1.055, 2.4) : gl / 12.92;
  bl = bl > 0.04045 ? Math.pow((bl + 0.055) / 1.055, 2.4) : bl / 12.92;
  let x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
  let y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750);
  let z = (rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041) / 1.08883;
  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export function findClosestFilament(r: number, g: number, b: number): FilamentMatch {
  const [L1, a1, b1] = rgbToLab(r, g, b);
  let bestDist = Infinity, bestIdx = 0;
  for (let i = 0; i < FILAMENTS.length; i++) {
    const [fr, fg, fb] = FILAMENTS[i];
    const [L2, a2, b2] = rgbToLab(fr, fg, fb);
    const dL = L1 - L2, da = a1 - a2, db = b1 - b2;
    const dist = Math.sqrt(dL * dL + da * da + db * db);
    if (dist < bestDist) { bestDist = dist; bestIdx = i; }
  }
  return { filament: FILAMENTS[bestIdx], deltaE: bestDist };
}

export function sizeEstimate(
  maxWidth: number,
  chamferWidth: number,
  aspectRatio: number
): string {
  const w = maxWidth;
  const h = Math.max(2, Math.round(w * aspectRatio));
  const totalCells = (w - 1) * (h - 1);
  const perimeter = 2 * (w + h);
  const boundaryBand = perimeter * chamferWidth * 2;
  const boundaryFrac = Math.min(0.5, boundaryBand / totalCells + 0.05);
  const boundaryCells = Math.round(totalCells * boundaryFrac);
  const mergedQuads = Math.round(totalCells * (1 - boundaryFrac) / 50);
  const topTris = (boundaryCells + mergedQuads) * 2;
  const bottomTris = Math.round(totalCells / 200) * 2;
  const sideTris = 2 * ((w - 1) + (h - 1)) * 2;
  const tris = topTris + bottomTris + sideTris;
  const mb = (84 + tris * 50) / (1024 * 1024);
  const noMergeMB = (84 + totalCells * 4 * 50 + sideTris * 50) / (1024 * 1024);
  const warn = mb > 300 ? ' ⚠️ may be slow' : '';
  return `~${mb.toFixed(0)} MB est. (${noMergeMB.toFixed(0)} MB without merging)${warn}`;
}
