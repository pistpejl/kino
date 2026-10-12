export type ContentMode = "sfw" | "nsfw";

export type ModelCategory = "image" | "video";

export interface CatalogModel {
  id: string;
  name: string;
  mode: ContentMode;
  category: ModelCategory;
  tag?: string;
}

export const IMAGE_MODELS: CatalogModel[] = [
  { id: "z-image-turbo", name: "Z-Image Turbo", mode: "sfw", category: "image", tag: "Fast" },
  { id: "seedream", name: "Seedream", mode: "sfw", category: "image", tag: "Default" },
  { id: "qwen-image", name: "Qwen Image", mode: "sfw", category: "image" },
  { id: "flux-schnell", name: "Flux Schnell", mode: "sfw", category: "image" },
  { id: "krea-2", name: "Krea 2", mode: "sfw", category: "image" },
  { id: "analog", name: "Analog", mode: "sfw", category: "image" },
  { id: "flux-klein", name: "Flux Klein", mode: "sfw", category: "image" },
  { id: "z-image", name: "Z-Image", mode: "sfw", category: "image" },
  { id: "minimax", name: "MiniMax", mode: "sfw", category: "image" },
  { id: "kling-nsfw", name: "Kling NSFW", mode: "nsfw", category: "image", tag: "Default" },
  { id: "pony", name: "Pony", mode: "nsfw", category: "image" },
];

export const VIDEO_MODELS: CatalogModel[] = [
  { id: "skyreels-2", name: "SkyReels 2.0", mode: "sfw", category: "video", tag: "Default" },
  { id: "ltx-2-3", name: "LTX 2.3", mode: "sfw", category: "video" },
  { id: "wan-3", name: "Wan 3.0", mode: "sfw", category: "video" },
  { id: "hunyuan-1-5", name: "Hunyuan 1.5", mode: "sfw", category: "video" },
  { id: "seedance-2-5", name: "Seedance 2.5", mode: "sfw", category: "video" },
  { id: "veo-3", name: "Veo 3", mode: "sfw", category: "video" },
  { id: "sora-2", name: "Sora 2", mode: "sfw", category: "video" },
  { id: "runway", name: "Runway", mode: "sfw", category: "video" },
  { id: "kling-nsfw-video", name: "Kling NSFW", mode: "nsfw", category: "video", tag: "Default" },
  { id: "minimax-h3", name: "MiniMax H3", mode: "nsfw", category: "video" },
];

export const DEFAULT_IMAGE_MODEL: Record<ContentMode, string> = {
  sfw: "seedream",
  nsfw: "kling-nsfw",
};

export const DEFAULT_VIDEO_MODEL: Record<ContentMode, string> = {
  sfw: "skyreels-2",
  nsfw: "kling-nsfw-video",
};

export function filterModels(
  models: CatalogModel[],
  mode: ContentMode
): CatalogModel[] {
  return models.filter((m) => m.mode === mode);
}

export function resolveModelId(
  models: CatalogModel[],
  currentId: string,
  mode: ContentMode,
  defaults: Record<ContentMode, string>
): string {
  const allowed = filterModels(models, mode);
  if (allowed.some((m) => m.id === currentId)) return currentId;
  return defaults[mode];
}

export function getModelName(
  models: CatalogModel[],
  id: string
): string {
  return models.find((m) => m.id === id)?.name ?? id;
}

export const SFW_DEFAULT_PROMPT =
  "Candid street photograph of an adult woman 21+, standing on a wet sidewalk at dusk, 85mm, natural light, real skin pores, shot on iPhone, Kodak Portra, raw photo, not illustration";

export const NSFW_DEFAULT_PROMPT =
  "Photoreal photograph of an adult woman 21+, nude, standing in a sunlit bedroom, 85mm, real skin pores, uncensored, not illustration";

export const RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;
export const RESOLUTIONS = ["512", "768", "1024"] as const;
