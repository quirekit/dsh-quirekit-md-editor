/** Minimal source edits between two texts, so an external change keeps the caret, scroll and comment anchors. */

/** Above this many line edits, one replacement is cheaper than locating every hunk. */
const MAX_LINE_EDITS = 1000;

/**
 * @param text - Source text.
 * @returns Lines with their terminators, so concatenation restores the text.
 */
function splitLines(text) {
  return text === '' ? [] : text.split(/(?<=\n)/u);
}

/**
 * Myers shortest edit script over the lines between the common head and tail.
 * @param before - Current lines.
 * @param after - Target lines.
 * @param start - Lines shared at the head.
 * @param n - Differing current lines.
 * @param m - Differing target lines.
 * @returns Ascending line hunks relative to the document, or undefined past the edit limit.
 */
function editScript(before, after, start, n, m) {
  const limit = Math.min(n + m, MAX_LINE_EDITS), offset = limit + 1;
  const furthest = new Int32Array(2 * limit + 3), trace = [];
  for (let depth = 0; depth <= limit; depth += 1) {
    trace.push(furthest.slice());
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      const down = diagonal === -depth || (diagonal !== depth && furthest[offset + diagonal - 1] < furthest[offset + diagonal + 1]);
      let x = down ? furthest[offset + diagonal + 1] : furthest[offset + diagonal - 1] + 1;
      let y = x - diagonal;
      while (x < n && y < m && before[start + x] === after[start + y]) { x += 1; y += 1; }
      furthest[offset + diagonal] = x;
      if (x >= n && y >= m) return backtrack(trace, offset, n, m, start);
    }
  }
  return undefined;
}

/**
 * Walk the recorded frontiers back into merged hunks.
 * @param trace - Frontier before each edit depth.
 * @param offset - Index of diagonal zero.
 * @param n - Differing current lines.
 * @param m - Differing target lines.
 * @param start - Lines shared at the head.
 * @returns Ascending, non-touching line hunks.
 */
function backtrack(trace, offset, n, m, start) {
  const hunks = [];
  let x = n, y = m;
  for (let depth = trace.length - 1; depth > 0; depth -= 1) {
    const frontier = trace[depth], diagonal = x - y;
    const down = diagonal === -depth || (diagonal !== depth && frontier[offset + diagonal - 1] < frontier[offset + diagonal + 1]);
    const previousDiagonal = down ? diagonal + 1 : diagonal - 1;
    const previousX = frontier[offset + previousDiagonal], previousY = previousX - previousDiagonal;
    const editX = down ? previousX : previousX + 1, editY = down ? previousY + 1 : previousY;
    const last = hunks.at(-1);
    if (last && last.fromA === start + editX && last.fromB === start + editY) {
      last.fromA = start + previousX; last.fromB = start + previousY;
    } else {
      hunks.push({ fromA: start + previousX, toA: start + editX, fromB: start + previousY, toB: start + editY });
    }
    x = previousX; y = previousY;
  }
  return hunks.reverse();
}

/**
 * Locate the changed line ranges.
 * @param before - Current lines.
 * @param after - Target lines.
 * @returns Ascending line hunks.
 */
function lineHunks(before, after) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let endA = before.length, endB = after.length;
  while (endA > start && endB > start && before[endA - 1] === after[endB - 1]) { endA -= 1; endB -= 1; }
  if (start === endA && start === endB) return [];
  const whole = [{ fromA: start, toA: endA, fromB: start, toB: endB }];
  if (start === endA || start === endB) return whole;
  return editScript(before, after, start, endA - start, endB - start) ?? whole;
}

/**
 * @param current - Text the offsets refer to.
 * @param target - Text to arrive at.
 * @returns Ascending, non-overlapping `{ from, to, insert }` changes, narrowed to the characters that differ.
 */
export function textChanges(current, target) {
  if (current === target) return [];
  const before = splitLines(current), after = splitLines(target);
  const offsets = [0];
  for (const line of before) offsets.push(offsets.at(-1) + line.length);
  return lineHunks(before, after).map(({ fromA, toA, fromB, toB }) => {
    const insert = after.slice(fromB, toB).join('');
    const from = offsets[fromA], to = offsets[toA];
    let head = 0;
    while (head < to - from && head < insert.length && current[from + head] === insert[head]) head += 1;
    let tail = 0;
    while (tail < to - from - head && tail < insert.length - head && current[to - 1 - tail] === insert[insert.length - 1 - tail]) tail += 1;
    return { from: from + head, to: to - tail, insert: insert.slice(head, insert.length - tail) };
  });
}
