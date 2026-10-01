export const clamp = (value, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

export function stageProgress(scrollY, top, height, viewportHeight) {
  const distance = height - viewportHeight;
  if (distance <= 0) return scrollY >= top ? 1 : 0;
  return clamp((scrollY - top) / distance);
}

export function chapterValues(progress) {
  const p = clamp(progress);
  return {
    heroOpacity: 1 - clamp((p - 0.4) / 0.55),
    headingOpacity: 1 - clamp((p - 0.55) / 0.35),
    captionOpacity: clamp((p - 0.45) / 0.3),
    activeRow: Math.min(3, Math.floor(p * 4)),
  };
}
