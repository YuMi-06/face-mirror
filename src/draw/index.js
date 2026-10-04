/** 画风注册表 */
import { draw as kawaii } from './kawaii.js';
import { draw as abstract } from './abstract.js';
import { draw as pixel } from './pixel.js';
import { draw as ink } from './ink.js';
import { drawSleepZs } from './util.js';

export const RENDERERS = { kawaii, abstract, pixel, ink };

/**
 * @param part 'all' = 背景 + 五官；'features' = 只画五官（多人同框时背景只铺一次）
 */
export function render(ctx, styleId, S, env, part = 'all') {
  const fn = RENDERERS[styleId] || RENDERERS.kawaii;
  fn(ctx, S, env, part);
  if (part !== 'features') drawSleepZs(ctx, S, env.pal, env.t);
}
