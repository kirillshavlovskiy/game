"""
DOS-like Labyrinth Game
A simple terminal game with random maze, multiple success paths, and grid-based movement.
"""
import random
import os

# Try Windows-specific input for real-time key capture
try:
    import msvcrt
    HAS_MSVCRT = True
except ImportError:
    HAS_MSVCRT = False


# Maze dimensions - each cell = 1 move. Try 5x5 for quick games, 10x10 for more challenge
WIDTH = 10
HEIGHT = 10

# Symbols
WALL = '#'
PATH = ' '
PLAYER = '@'
GOAL = 'X'
START = 'S'


class Labyrinth:
    """Generates a random labyrinth with multiple intersecting paths."""

    def __init__(self, width: int, height: int, extra_paths: int = 5):
        self.width = width
        self.height = height
        self.extra_paths = extra_paths  # Extra passages to create multiple routes
        self.grid = []
        self.player_x = 0
        self.player_y = 0
        self.goal_x = width - 1
        self.goal_y = height - 1

    def _init_grid(self) -> None:
        """Create a grid full of walls."""
        self.grid = [[WALL for _ in range(self.width)] for _ in range(self.height)]

    def _carve_path(self, x: int, y: int) -> None:
        """Recursive backtracking - carve paths (1 cell = 1 move)."""
        self.grid[y][x] = PATH

        directions = [(0, -1), (1, 0), (0, 1), (-1, 0)]
        random.shuffle(directions)

        for dx, dy in directions:
            nx, ny = x + dx, y + dy
            if 0 <= nx < self.width and 0 <= ny < self.height and self.grid[ny][nx] == WALL:
                self._carve_path(nx, ny)

    def _ensure_goal_reachable(self) -> None:
        """If goal is wall, carve a path from goal to nearest open cell."""
        gx, gy = self.goal_x, self.goal_y
        if self.grid[gy][gx] == PATH:
            return
        from collections import deque
        q = deque([(gx, gy)])
        seen = {(gx, gy)}
        parent = {}
        found = None
        while q:
            x, y = q.popleft()
            for dx, dy in [(0, -1), (1, 0), (0, 1), (-1, 0)]:
                nx, ny = x + dx, y + dy
                if 0 <= nx < self.width and 0 <= ny < self.height:
                    if self.grid[ny][nx] == PATH:
                        found = (x, y)
                        break
                    if (nx, ny) not in seen:
                        seen.add((nx, ny))
                        parent[(nx, ny)] = (x, y)
                        q.append((nx, ny))
            if found:
                break
        if found:
            cur = found
            while True:
                self.grid[cur[1]][cur[0]] = PATH
                if cur == (gx, gy):
                    break
                cur = parent[cur]

    def _add_extra_paths(self) -> None:
        """Remove random walls to create multiple intersecting success paths."""
        internal_walls = []
        for y in range(1, self.height - 1):
            for x in range(1, self.width - 1):
                if self.grid[y][x] == WALL:
                    internal_walls.append((x, y))

        to_remove = min(self.extra_paths, len(internal_walls))
        for _ in range(to_remove):
            if internal_walls:
                x, y = random.choice(internal_walls)
                self.grid[y][x] = PATH
                internal_walls.remove((x, y))

    def generate(self) -> None:
        """Generate the labyrinth with multiple paths."""
        self._init_grid()
        self._carve_path(0, 0)
        self._ensure_goal_reachable()
        self._add_extra_paths()

        self.grid[0][0] = PATH
        self.grid[self.height - 1][self.width - 1] = PATH

    def can_move(self, x: int, y: int) -> bool:
        """Check if position is valid (within bounds and not a wall)."""
        return 0 <= x < self.width and 0 <= y < self.height and self.grid[y][x] != WALL

    def move_player(self, dx: int, dy: int) -> bool:
        """Move player by (dx, dy). Returns True if move was successful."""
        nx = self.player_x + dx
        ny = self.player_y + dy
        if self.can_move(nx, ny):
            self.player_x = nx
            self.player_y = ny
            return True
        return False

    def is_goal_reached(self) -> bool:
        """Check if player reached the goal."""
        return self.player_x == self.goal_x and self.player_y == self.goal_y

    def render(self) -> str:
        """Render the labyrinth as a string."""
        lines = []
        for y in range(self.height):
            row = []
            for x in range(self.width):
                if x == self.player_x and y == self.player_y:
                    row.append(PLAYER)
                elif x == self.goal_x and y == self.goal_y:
                    row.append(GOAL)
                elif x == 0 and y == 0 and (self.player_x != 0 or self.player_y != 0):
                    row.append(START)
                else:
                    row.append(self.grid[y][x])
            lines.append(''.join(row))
        return '\n'.join(lines)


def clear_screen():
    """Clear terminal screen (cross-platform)."""
    os.system('cls' if os.name == 'nt' else 'clear')


def get_key_windows():
    """Get a single keypress on Windows (blocking)."""
    ch = msvcrt.getch()
    if ch == b'\xe0':  # Arrow key prefix
        ch = msvcrt.getch()
    return ch


def main():
    print("=" * 40)
    print("  LABYRINTH - DOS-style Maze Game")
    print("=" * 40)
    print("\n  Find your way from S to X!")
    print("  Controls: W/Up, S/Down, A/Left, D/Right")
    print("  Press Q to quit, R to regenerate maze")
    print("\n  Press Enter to start...")
    input()

    # Key mappings
    key_map = {
        b'w': (0, -1), b'W': (0, -1),
        b's': (0, 1),  b'S': (0, 1),
        b'a': (-1, 0), b'A': (-1, 0),
        b'd': (1, 0),  b'D': (1, 0),
        # Arrow keys (Windows)
        b'H': (0, -1),  # Up
        b'P': (0, 1),   # Down
        b'K': (-1, 0),  # Left
        b'M': (1, 0),   # Right
    }

    lab = Labyrinth(WIDTH, HEIGHT, extra_paths=8)
    lab.generate()

    moves = 0

    while True:
        clear_screen()
        print("\n  LABYRINTH")
        print("  " + "-" * (WIDTH + 2))
        for line in lab.render().split('\n'):
            print("  " + line)
        print("  " + "-" * (WIDTH + 2))
        print(f"  Moves: {moves}  |  S=Start  @=You  X=Goal")
        print("\n  W/A/S/D to move, R=New maze, Q=Quit")

        if lab.is_goal_reached():
            print("\n  *** YOU WON! ***")
            print(f"  Completed in {moves} moves!")
            print("\n  Press Enter to play again, Q to quit...")
            key = input().strip().lower()
            if key == 'q':
                break
            lab.generate()
            lab.player_x, lab.player_y = 0, 0
            moves = 0
            continue

        # Get input
        if HAS_MSVCRT:
            key = get_key_windows()
            if key in (b'q', b'Q'):
                print("\n  Goodbye!")
                break
            if key in (b'r', b'R'):
                lab.generate()
                lab.player_x, lab.player_y = 0, 0
                moves = 0
                continue
            if key in key_map:
                dx, dy = key_map[key]
                if lab.move_player(dx, dy):
                    moves += 1
        else:
            cmd = input("  Move (W/A/S/D): ").strip().lower()
            if cmd == 'q':
                break
            if cmd == 'r':
                lab.generate()
                lab.player_x, lab.player_y = 0, 0
                moves = 0
                continue
            move_map = {'w': (0, -1), 's': (0, 1), 'a': (-1, 0), 'd': (1, 0)}
            if cmd in move_map:
                dx, dy = move_map[cmd]
                if lab.move_player(dx, dy):
                    moves += 1


if __name__ == "__main__":
    main()
