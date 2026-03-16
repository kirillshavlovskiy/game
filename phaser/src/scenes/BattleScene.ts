import Phaser from 'phaser';
import {
  resolveCombat,
  rollD6,
  getMonsterName,
  type MonsterType,
  type CombatResult,
} from '../combat';

const CELL_SIZE = 48;
const GRID_WIDTH = 13;
const GRID_HEIGHT = 10;
const MONSTER_TYPES: MonsterType[] = ['Z', 'S', 'G', 'K', 'V'];

interface MonsterData {
  x: number;
  y: number;
  type: MonsterType;
  hasShield?: boolean;
  sprite?: Phaser.GameObjects.Graphics;
}

export class BattleScene extends Phaser.Scene {
  private grid!: boolean[][];
  private playerX = 0;
  private playerY = 0;
  private playerSprite!: Phaser.GameObjects.Graphics;
  private monsters: MonsterData[] = [];
  private playerHp = 3;
  private playerAttackBonus = 0;
  private playerShield = 0;
  private inCombat = false;
  private combatResult: CombatResult | null = null;
  private diceResult: number | null = null;
  private rollingDice = false;
  private uiText!: Phaser.GameObjects.Text;
  private combatText!: Phaser.GameObjects.Text;
  private rollButton!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'BattleScene' });
  }

  create() {
    this.cameras.main.setBackgroundColor('#0a0a0f');
    this.grid = this.createGrid();
    this.spawnMonsters();
    this.drawArena();
    this.createPlayer();
    this.createMonsterSprites();
    this.setupInput();
    this.createUI();
    this.updateUI();
  }

  private createGrid(): boolean[][] {
    const grid: boolean[][] = [];
    for (let y = 0; y < GRID_HEIGHT; y++) {
      grid[y] = [];
      for (let x = 0; x < GRID_WIDTH; x++) {
        const isWall = x === 0 || x === GRID_WIDTH - 1 || y === 0 || y === GRID_HEIGHT - 1;
        grid[y][x] = !isWall;
      }
    }
    return grid;
  }

  private spawnMonsters() {
    const types: MonsterType[] = ['Z', 'S', 'G', 'K'];
    const positions: [number, number][] = [];
    for (let y = 2; y < GRID_HEIGHT - 2; y++) {
      for (let x = 2; x < GRID_WIDTH - 2; x++) {
        if ((x !== 1 || y !== 1) && (x !== GRID_WIDTH - 2 || y !== GRID_HEIGHT - 2)) {
          positions.push([x, y]);
        }
      }
    }
    const shuffled = positions.sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(4, shuffled.length); i++) {
      const [x, y] = shuffled[i];
      this.monsters.push({
        x,
        y,
        type: types[i % types.length],
        hasShield: types[i % types.length] === 'K',
      });
    }
  }

  private drawArena() {
    const g = this.add.graphics();
    const offsetX = (this.scale.width - GRID_WIDTH * CELL_SIZE) / 2;
    const offsetY = 40;

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const px = offsetX + x * CELL_SIZE;
        const py = offsetY + y * CELL_SIZE;
        const walkable = this.grid[y][x];
        g.fillStyle(walkable ? 0x1a1a24 : 0x2a2a35, 1);
        g.fillRect(px, py, CELL_SIZE - 1, CELL_SIZE - 1);
        g.lineStyle(1, walkable ? 0x333344 : 0x444455, 1);
        g.strokeRect(px, py, CELL_SIZE - 1, CELL_SIZE - 1);
      }
    }
  }

  private getOffset() {
    return {
      x: (this.scale.width - GRID_WIDTH * CELL_SIZE) / 2,
      y: 40,
    };
  }

  private createPlayer() {
    this.playerX = 1;
    this.playerY = 1;
    const { x, y } = this.getOffset();
    this.playerSprite = this.add.graphics();
    this.playerSprite.fillStyle(0x00ff88, 1);
    this.playerSprite.fillCircle(
      x + this.playerX * CELL_SIZE + CELL_SIZE / 2,
      y + this.playerY * CELL_SIZE + CELL_SIZE / 2,
      CELL_SIZE / 3
    );
    this.playerSprite.lineStyle(2, 0x66ffaa, 1);
    this.playerSprite.strokeCircle(
      x + this.playerX * CELL_SIZE + CELL_SIZE / 2,
      y + this.playerY * CELL_SIZE + CELL_SIZE / 2,
      CELL_SIZE / 3
    );
  }

  private createMonsterSprites() {
    const { x: ox, y: oy } = this.getOffset();
    const icons: Record<MonsterType, string> = {
      V: '🧛',
      Z: '🧟',
      S: '🕷',
      G: '👻',
      K: '💀',
    };
    for (const m of this.monsters) {
      const g = this.add.graphics();
      g.fillStyle(0xcc4444, 0.9);
      g.fillCircle(
        ox + m.x * CELL_SIZE + CELL_SIZE / 2,
        oy + m.y * CELL_SIZE + CELL_SIZE / 2,
        CELL_SIZE / 3 - 2
      );
      m.sprite = g;
    }
  }

  private setupInput() {
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (this.inCombat || this.rollingDice) return;
      const dirs: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        w: [0, -1],
        s: [0, 1],
        a: [-1, 0],
        d: [1, 0],
      };
      const d = dirs[e.key];
      if (d) {
        e.preventDefault();
        this.tryMovePlayer(d[0], d[1]);
      }
    });
  }

  private tryMovePlayer(dx: number, dy: number) {
    const nx = this.playerX + dx;
    const ny = this.playerY + dy;
    if (nx < 0 || nx >= GRID_WIDTH || ny < 0 || ny >= GRID_HEIGHT) return;
    if (!this.grid[ny][nx]) return;

    const monster = this.monsters.find((m) => m.x === nx && m.y === ny);
    if (monster) {
      this.playerX = nx;
      this.playerY = ny;
      this.updateSprites();
      this.startCombat(monster);
      return;
    }

    this.playerX = nx;
    this.playerY = ny;
    this.updateSprites();
    this.moveMonsters();
    this.checkMonsterCollision();
    this.updateUI();
  }

  private moveMonsters() {
    for (const m of this.monsters) {
      const dist = Math.abs(m.x - this.playerX) + Math.abs(m.y - this.playerY);
      if (dist > 4) continue;
      if (dist <= 1) {
        this.startCombat(m);
        return;
      }
      const dx = Math.sign(this.playerX - m.x);
      const dy = Math.sign(this.playerY - m.y);
      let nx = m.x;
      let ny = m.y;
      if (dx !== 0 && this.canMove(m.x + dx, m.y)) nx = m.x + dx;
      else if (dy !== 0 && this.canMove(m.x, m.y + dy)) ny = m.y + dy;
      if (nx !== m.x || ny !== m.y) {
        const blocked = this.monsters.some(
          (o) => o !== m && o.x === nx && o.y === ny
        );
        if (!blocked && (nx !== this.playerX || ny !== this.playerY)) {
          m.x = nx;
          m.y = ny;
        }
      }
    }
  }

  private canMove(x: number, y: number): boolean {
    if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) return false;
    return this.grid[y][x];
  }

  private checkMonsterCollision() {
    const m = this.monsters.find((m) => m.x === this.playerX && m.y === this.playerY);
    if (m) this.startCombat(m);
  }

  private startCombat(monster: MonsterData) {
    this.inCombat = true;
    this.combatResult = null;
    this.diceResult = null;
    this.combatText.setText(`Battle vs ${getMonsterName(monster.type)}!\nRoll the dice to attack.`);
    this.rollButton.setVisible(true);
    this.rollButton.setInteractive();
    this.updateUI();
  }

  private doCombatRoll() {
    if (!this.rollingDice && this.inCombat) {
      this.rollingDice = true;
      this.rollButton.setVisible(false);
      const roll = rollD6();
      this.diceResult = roll;
      const monster = this.monsters.find((m) => m.x === this.playerX && m.y === this.playerY);
      if (!monster) {
        this.inCombat = false;
        this.rollingDice = false;
        return;
      }
      const result = resolveCombat(
        roll,
        this.playerAttackBonus,
        monster.type,
        monster.hasShield
      );
      this.combatResult = result;

      if (result.won) {
        const idx = this.monsters.indexOf(monster);
        this.monsters.splice(idx, 1);
        monster.sprite?.destroy();
        this.applyReward(result.reward);
        this.combatText.setText(`Victory! Roll: ${roll} vs def ${result.monsterDefense}`);
      } else {
        if (this.playerShield > 0) {
          this.playerShield--;
          this.combatText.setText(`Shield absorbed! Roll: ${roll} vs def ${result.monsterDefense}`);
        } else {
          this.playerHp = Math.max(0, this.playerHp - result.damage);
          this.combatText.setText(
            `Hit! -${result.damage} HP. Roll: ${roll} vs def ${result.monsterDefense}`
          );
        }
        if (monster.type === 'K' && result.monsterEffect === 'skeleton_shield') {
          monster.hasShield = false;
        }
      }

      this.time.delayedCall(1500, () => {
        this.rollingDice = false;
        this.inCombat = false;
        this.combatResult = null;
        this.combatText.setText('');
        this.updateSprites();
        this.updateUI();
        if (this.playerHp <= 0) {
          this.combatText.setText('GAME OVER - You were defeated! Press R to restart.');
        } else if (this.monsters.length === 0) {
          this.combatText.setText('You cleared the arena! Press R to restart.');
        } else {
          this.rollButton.setVisible(false);
        }
      });
    }
  }

  private applyReward(reward: CombatResult['reward']) {
    if (!reward) return;
    switch (reward.type) {
      case 'hp':
        this.playerHp = Math.min(5, this.playerHp + reward.amount);
        break;
      case 'shield':
        this.playerShield += reward.amount;
        break;
      case 'attackBonus':
        this.playerAttackBonus += reward.amount;
        break;
    }
  }

  private updateSprites() {
    const { x: ox, y: oy } = this.getOffset();
    this.playerSprite.clear();
    this.playerSprite.fillStyle(0x00ff88, 1);
    this.playerSprite.fillCircle(
      ox + this.playerX * CELL_SIZE + CELL_SIZE / 2,
      oy + this.playerY * CELL_SIZE + CELL_SIZE / 2,
      CELL_SIZE / 3
    );
    this.playerSprite.lineStyle(2, 0x66ffaa, 1);
    this.playerSprite.strokeCircle(
      ox + this.playerX * CELL_SIZE + CELL_SIZE / 2,
      oy + this.playerY * CELL_SIZE + CELL_SIZE / 2,
      CELL_SIZE / 3
    );

    for (const m of this.monsters) {
      if (!m.sprite) continue;
      m.sprite.clear();
      m.sprite.fillStyle(0xcc4444, 0.9);
      m.sprite.fillCircle(
        ox + m.x * CELL_SIZE + CELL_SIZE / 2,
        oy + m.y * CELL_SIZE + CELL_SIZE / 2,
        CELL_SIZE / 3 - 2
      );
    }
  }

  private createUI() {
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontSize: '14px',
      color: '#c0c0c0',
      fontFamily: 'Courier New, monospace',
    };
    this.uiText = this.add.text(16, 8, '', style);
    this.combatText = this.add.text(
      this.scale.width / 2,
      this.scale.height - 80,
      '',
      { ...style, fontSize: '16px', align: 'center' }
    );
    this.combatText.setOrigin(0.5, 0);

    this.rollButton = this.add
      .text(this.scale.width / 2, this.scale.height - 40, 'ROLL DICE', {
        ...style,
        fontSize: '18px',
        backgroundColor: '#00ff88',
        color: '#0a0a0f',
      })
      .setPadding(16, 8)
      .setOrigin(0.5, 0)
      .setInteractive({ useHandCursor: true })
      .setVisible(false);

    this.rollButton.on('pointerdown', () => this.doCombatRoll());

    this.input.keyboard?.on('keydown-R', () => this.scene.restart());
  }

  private updateUI() {
    this.uiText.setText(
      `HP: ${this.playerHp} | Shield: ${this.playerShield} | Atk+: ${this.playerAttackBonus}\n` +
        `Monsters: ${this.monsters.length} | WASD/Arrows to move | R = Restart`
    );
  }
}
