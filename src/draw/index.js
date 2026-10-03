/** 画风注册表 */
import { draw as kawaii } from './kawaii.js';
import { draw as abstract } from './abstract.js';
import { draw as pixel } from './pixel.js';
import { draw as ink } from './ink.js';
import { drawSleepZs } from './util.js';

export const RENDERERS = { kawaii, abstract, pixel, ink };

export function render(ctx, styleId, S, env) {
  const fn = RENDERERS[styleId] || RENDERERS.kawaii;
  fn(ctx, S, env);
  drawSleepZs(ctx, S, env.pal, env.t);
}
