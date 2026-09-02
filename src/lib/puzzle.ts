export const GRID_SIZE = 3;

export function isSolved(board: number[]): boolean {
  const solved = Array.from({ length: board.length }, (_, index) =>
    index === board.length - 1 ? 0 : index + 1,
  );

  return board.every((value, index) => value === solved[index]);
}

export function isAdjacent(index: number, emptyIndex: number, size = GRID_SIZE): boolean {
  const currentRow = Math.floor(index / size);
  const currentColumn = index % size;
  const emptyRow = Math.floor(emptyIndex / size);
  const emptyColumn = emptyIndex % size;

  return Math.abs(currentRow - emptyRow) + Math.abs(currentColumn - emptyColumn) === 1;
}

function shuffleBoard(board: number[]): number[] {
  const next = [...board];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
}

export function createShuffledBoard(size = GRID_SIZE): number[] {
  const tileCount = size * size;
  const board = Array.from({ length: tileCount }, (_, index) =>
    index === tileCount - 1 ? 0 : index + 1,
  );

  let next = shuffleBoard(board);
  let iterations = 0;

  while ((isSolved(next) || !isSolvable(next, size)) && iterations < 100) {
    next = shuffleBoard(board);
    iterations += 1;
  }

  return next;
}

function isSolvable(board: number[], size: number): boolean {
  const tiles = board.filter((tile) => tile !== 0);
  let inversions = 0;

  for (let index = 0; index < tiles.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < tiles.length; nextIndex += 1) {
      if (tiles[index] > tiles[nextIndex]) {
        inversions += 1;
      }
    }
  }

  if (size % 2 !== 0) {
    return inversions % 2 === 0;
  }

  const blankRowFromBottom = size - Math.floor(board.indexOf(0) / size);
  return blankRowFromBottom % 2 === 0 ? inversions % 2 !== 0 : inversions % 2 === 0;
}
