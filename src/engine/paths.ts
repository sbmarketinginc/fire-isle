// Legal movement enumeration.
import { ADJ, SPACE } from './board.ts';
import type { CaveNum, GameState, PlayerId, PlayerState } from './types.ts';

export const CAVE_PREFIX = 'CAVE:';

export function occupant(state: GameState, spaceId: string): PlayerState | undefined {
  return state.players.find((p) => p.loc.kind === 'space' && p.loc.id === spaceId);
}

export function caveOccupant(state: GameState, n: CaveNum): PlayerState | undefined {
  return state.players.find((p) => p.loc.kind === 'cave' && p.loc.n === n);
}

export interface PathOptions {
  /** the moving player */
  player: PlayerId;
  /** number of spaces to move */
  steps: number;
  /** space to start counting from (already "adjacent"); first step lands on a neighbour of this */
  from: string;
  /** when leaving a cave / pit / water the first step is a fixed space that counts as space 1 */
  firstStep?: string;
  /** allow entering caves (not when moving back) */
  allowCaves?: boolean;
  /** movement is a penalty (MOVE BACK): may not capture the jewel, enter caves, or reach the dock */
  penalty?: boolean;
}

/**
 * Enumerate every legal path. A path is the ordered list of space ids stepped on.
 * A path that ends by entering a cave has 'CAVE:n' as its last element.
 * Rules applied (1986 rulebook):
 *  - move the full count in any direction, never onto the same space twice in one move
 *  - if the landing space is occupied, continue to the next open space
 *  - a bridge counts as a space; an unoccupied bridge stops you; an occupied one may be crossed
 *  - Vul-Kar Point captures the jewel and ends the move (no exact count needed) while the jewel rests there
 *  - the Dock is the finish (no exact count); reaching it with the jewel wins
 *  - entering an adjacent cave counts as a space and ends the move
 */
export function legalPaths(state: GameState, opts: PathOptions): string[][] {
  const results: string[][] = [];
  const partial: string[][] = []; // moves cut short by a dead end (only offered when nothing else is legal)
  const jewelAtVulkar = state.jewel.kind === 'vulkar';
  const seen = new Set<string>();

  const push = (path: string[], short = false) => {
    const key = path.join('>');
    if (!seen.has(key)) {
      seen.add(key);
      (short ? partial : results).push(path);
    }
  };

  const walk = (current: string, visited: Set<string>, remaining: number, path: string[], bumping: boolean) => {
    const neighbours = ADJ[current] ?? [];
    let extended = false;
    for (const n of neighbours) {
      if (visited.has(n)) continue;
      const sp = SPACE[n];
      if (sp.special === 'dock') {
        // the Finish Space: no exact count needed; whoever holds the jewel on arrival wins
        if (!opts.penalty) {
          push([...path, n]);
          extended = true;
        }
        continue;
      }
      if (sp.special === 'water') continue; // never walk into the water
      if (sp.special === 'vulkar' && jewelAtVulkar) {
        if (!opts.penalty) {
          push([...path, n]); // capture: end the move here, no exact count needed
          extended = true;
        }
        continue; // before the jewel is captured Vul-Kar Point is not a through space
      }
      const occ = occupant(state, n);
      const nextPath = [...path, n];
      const nextVisited = new Set(visited);
      nextVisited.add(n);
      const left = bumping ? 0 : remaining - 1;

      if (sp.bridge) {
        if (!occ) {
          push(nextPath); // must stop on an unoccupied bridge
          extended = true;
          continue;
        }
        // occupied bridge: may cross (cannot stop here)
        if (left > 0) {
          walk(n, nextVisited, left, nextPath, false);
        } else {
          walk(n, nextVisited, 1, nextPath, true); // landing on an occupied space: move on to the next open one
        }
        extended = true;
        continue;
      }

      if (left > 0) {
        walk(n, nextVisited, left, nextPath, false);
        extended = true;
        // caves may be entered instead of using the remaining count
        if (opts.allowCaves && !opts.penalty && sp.caveEntry && !caveOccupant(state, sp.caveEntry)) {
          // entering counts as a space; the entry space may be occupied (occupied spaces are passed over)
          push([...nextPath, `${CAVE_PREFIX}${sp.caveEntry}`]);
        }
      } else if (occ) {
        // landing on an occupied space: continue to the next open space (mover chooses direction)
        walk(n, nextVisited, 1, nextPath, true);
        extended = true;
      } else {
        push(nextPath);
        extended = true;
      }
    }
    // dead end (nowhere to go): the piece can only stop short if no full move exists anywhere
    if (!extended && path.length > 0 && !bumping) push(path, true);
  };

  if (opts.firstStep) {
    // leaving a cave / pit / water: the first step is fixed and counts as one space
    const first = opts.firstStep;
    const occ = occupant(state, first);
    const path = [first];
    const visited = new Set([first]);
    if (opts.steps === 1) {
      if (occ) walk(first, visited, 1, path, true);
      else push(path);
    } else {
      walk(first, visited, opts.steps - 1, path, false);
    }
    // entering the cave right next to the exit space with the remaining count
    if (opts.allowCaves && opts.steps > 1 && SPACE[first].caveEntry && !caveOccupant(state, SPACE[first].caveEntry!)) {
      push([first, `${CAVE_PREFIX}${SPACE[first].caveEntry}`]);
    }
  } else {
    // if starting on the cave entry space itself, the cave can be entered as the first step
    if (opts.allowCaves && !opts.penalty && SPACE[opts.from]?.caveEntry && !caveOccupant(state, SPACE[opts.from].caveEntry!)) {
      push([`${CAVE_PREFIX}${SPACE[opts.from].caveEntry}`]);
    }
    walk(opts.from, new Set([opts.from]), opts.steps, [], false);
  }
  return results.length > 0 ? results : partial;
}

export function pathEndsInCave(path: string[]): CaveNum | undefined {
  const last = path[path.length - 1];
  if (last?.startsWith(CAVE_PREFIX)) return Number(last.slice(CAVE_PREFIX.length)) as CaveNum;
  return undefined;
}
