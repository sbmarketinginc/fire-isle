// Re-exports of board data used by the 3D layer, plus bridge endpoint definitions.
export { CAVE, FIREBALL, FIREBALLS, JEWEL_REST, PIT, ROUTE, RUIN, SPACE } from '../../engine/board.ts';
export { CAVE_PREFIX } from '../../engine/paths.ts';

export const BRIDGE_DEFS = [
  { id: 'BRIDGE1', from: 'GSB5', to: 'CP1' },
  { id: 'BRIDGE2', from: 'CP3', to: 'VP1' },
];
