export const AGE_GATE_KEY = "kino-age-verified-21";
export const MODE_KEY = "kino-content-mode";
export const GALLERY_KEY = "kino-gallery";

export interface GalleryItem {
  id: string;
  url: string;
  prompt: string;
  model: string;
  mode: "sfw" | "nsfw";
  createdAt: number;
  /** True when free Horde backend approximated the catalog model */
  approx?: boolean;
  provider?: string;
  providerNote?: string;
}

function migrateGalleryUrl(url: string): string {
  if (url.startsWith("/generated/") && !url.startsWith("/api/generated/")) {
    return `/api/generated/${url.slice("/generated/".length)}`;
  }
  return url;
}

export function loadGallery(): GalleryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(GALLERY_KEY);
    if (!raw) return [];
    const items: GalleryItem[] = JSON.parse(raw);
    let changed = false;
    const migrated = items.map((item) => {
      const next = migrateGalleryUrl(item.url);
      if (next !== item.url) {
        changed = true;
        return { ...item, url: next };
      }
      return item;
    });
    if (changed) saveGallery(migrated);
    return migrated;
  } catch {
    return [];
  }
}

export function saveGallery(items: GalleryItem[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(GALLERY_KEY, JSON.stringify(items.slice(0, 48)));
}

export function addGalleryItem(item: GalleryItem) {
  const items = loadGallery();
  items.unshift(item);
  saveGallery(items);
  return items;
}
