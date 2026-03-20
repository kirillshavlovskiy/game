import Phaser from 'phaser';
import {
  resolveCombat,
  rollD6,
  getMonsterName,
  getMonsterDefense,
  getMonsterHint,
  type MonsterType,
  type CombatResult,
} from '../combat';

const CELL_SIZE = 48;
const GRID_WIDTH = 13;
const GRID_HEIGHT = 10;

interface MonsterData {
  x: number;
  y: number;
  type: MonsterType;
  hasShield?: boolean;
  sprite?: Phaser.GameObjects.Graphics;
}

/** Draws a dice face (1-6 pips) on graphics at center */
function drawDiceFace(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  size: number,
  value: number,
  color = 0xffffff
) {
  g.fillStyle(color, 1);
  g.fillRoundedRect(cx - size / 2, cy - size / 2, size, size, 6);
  g.lineStyle(2, 0x888888, 1);
  g.strokeRoundedRect(cx - size / 2, cy - size / 2, size, size, 6);

  const r = size * 0.12;
  const gap = size * 0.25;
  const pip = (px: number, py: number) => {
    g.fillStyle(0x222222, 1);
    g.fillCircle(cx + px, cy + py, r);
  };

  switch (value) {
    case 1:
      pip(0, 0);
      break;
    case 2:
      pip(-gap, -gap);
      pip(gap, gap);
      break;
    case 3:
      pip(-gap, -gap);
      pip(0, 0);
      pip(gap, gap);
      break;
    case 4:
      pip(-gap, -gap);
      pip(gap, -gap);
      pip(-gap, gap);
      pip(gap, gap);
      break;
    case 5:
      pip(-gap, -gap);
      pip(gap, -gap);
      pip(0, 0);
      pip(-gap, gap);
      pip(gap, gap);
      break;
    case 6:
      pip(-gap, -gap);
      pip(gap, -gap);
      pip(-gap, 0);
      pip(gap, 0);
      pip(-gap, gap);
      pip(gap, gap);
      break;
  }
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
  private currentCombatMonster: MonsterData | null = null;
  private combatResult: CombatResult | null = null;
  private diceResult: number | null = null;
  private rollingDice = false;
  private uiText!: Phaser.GameObjects.Text;
  private combatText!: Phaser.GameObjects.Text;
  private rollButton!: Phaser.GameObjects.Text;
  private combatPanel!: Phaser.GameObjects.Container;
  private diceGraphics!: Phaser.GameObjects.Graphics;
  private monsterDefenseText!: Phaser.GameObjects.Text;
  private combatHintText!: Phaser.GameObjects.Text;

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
    this.createCombatPanel();
    this.createDice();
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

  private createCombatPanel() {
    const panelBg = this.add.graphics();
    const w = 320;
    const h = 180;
    const x = this.scale.width / 2 - w / 2;
    const y = this.scale.height - h - 20;

    this.combatPanel = this.add.container(0, 0);
    this.combatPanel.add(panelBg);
    panelBg.fillStyle(0x1a1a24, 0.98);
    panelBg.fillRoundedRect(x, y, w, h, 12);
    panelBg.lineStyle(2, 0x00ff88, 0.8);
    panelBg.strokeRoundedRect(x, y, w, h, 12);

    const title = this.add.text(this.scale.width / 2, y + 20, 'BATTLE — Roll to attack!', {
      fontSize: '16px',
      color: '#00ff88',
      fontFamily: 'Courier New, monospace',
    }).setOrigin(0.5, 0);
    this.combatPanel.add(title);

    const monsterName = this.add.text(this.scale.width / 2, y + 44, '', {
      fontSize: '16px',
      color: '#ff6666',
      fontFamily: 'Courier New, monospace',
    }).setOrigin(0.5, 0);
    this.combatPanel.add(monsterName);

    this.monsterDefenseText = this.add.text(this.scale.width / 2, y + 66, '', {
      fontSize: '13px',
      color: '#c0c0c0',
      fontFamily: 'Courier New, monospace',
    }).setOrigin(0.5, 0);
    this.combatPanel.add(this.monsterDefenseText);

    this.combatHintText = this.add.text(this.scale.width / 2, y + 92, '', {
      fontSize: '12px',
      color: '#ffcc00',
      fontFamily: 'Courier New, monospace',
      align: 'center',
      wordWrap: { width: w - 24 },
    }).setOrigin(0.5, 0);
    this.combatPanel.add(this.combatHintText);

    this.combatPanel.setVisible(false);
  }

  private createDice() {
    const cx = this.scale.width / 2;
    const cy = this.scale.height - 100;
    this.diceGraphics = this.add.graphics();
    this.diceGraphics.setVisible(false);
  }

  private showFloatingDamage(x: number, y: number, text: string, color: string) {
    const t = this.add.text(x, y, text, {
      fontSize: '24px',
      color,
      fontFamily: 'Courier New, monospace',
      stroke: '#000',
      strokeThickness: 4,
    }).setOrigin(0.5, 0.5);

    this.tweens.add({
      targets: t,
      y: y - 50,
      alpha: 0,
      duration: 800,
      ease: 'Power2',
      onComplete: () => t.destroy(),
    });
  }

  private screenShake(intensity = 8) {
    const cam = this.cameras.main;
    const origX = cam.scrollX;
    const origY = cam.scrollY;
    let i = 0;
    const iv = setInterval(() => {
      cam.setScroll(origX + (Math.random() - 0.5) * intensity, origY + (Math.random() - 0.5) * intensity);
      i++;
      if (i >= 8) {
        clearInterval(iv);
        cam.setScroll(origX, origY);
      }
    }, 40);
  }

  private startCombat(monster: MonsterData) {
    this.inCombat = true;
    this.currentCombatMonster = monster;
    this.combatResult = null;
    this.diceResult = null;

    const def = getMonsterDefense(monster.type);
    const shieldNote = monster.type === 'K' && monster.hasShield ? ' (shield!)' : '';
    this.monsterDefenseText.setText(`Defense: ${def}${shieldNote} | Your Atk+: ${this.playerAttackBonus}`);
    this.combatHintText.setText(getMonsterHint(monster.type, monster.hasShield));

    const title = this.combatPanel.getAt(1) as Phaser.GameObjects.Text;
    const nameEl = this.combatPanel.getAt(2) as Phaser.GameObjects.Text;
    title.setText('BATTLE — Roll to attack!');
    nameEl.setText(getMonsterName(monster.type));

    this.combatPanel.setVisible(true);
    this.combatText.setText('Click ROLL DICE or press SPACE to attack!');
    this.rollButton.setVisible(true);
    this.rollButton.setInteractive();
    this.diceGraphics.setVisible(false);

    const flash = this.add.rectangle(0, 0, this.scale.width * 2, this.scale.height * 2, 0xffffff, 0.3)
      .setOrigin(0.5).setScrollFactor(0);
    flash.setPosition(this.scale.width / 2, this.scale.height / 2);
    this.tweens.add({ targets: flash, alpha: 0, duration: 200, onComplete: () => flash.destroy() });

    this.updateUI();
  }

  private doCombatRoll() {
    if (this.rollingDice || !this.inCombat) return;
    const monster = this.currentCombatMonster;
    if (!monster || !this.monsters.includes(monster)) {
      this.endCombat();
      return;
    }

    this.rollingDice = true;
    this.rollButton.setVisible(false);

    const cx = this.scale.width / 2;
    const cy = this.scale.height - 100;
    const diceSize = 56;

    this.diceGraphics.setVisible(true);
    this.diceGraphics.clear();

    const roll = rollD6();
    const result = resolveCombat(
      roll,
      this.playerAttackBonus,
      monster.type,
      monster.hasShield
    );
    this.combatResult = result;

    let frame = 0;
    const rollFrames = 12;
    const rollTween = this.tweens.addCounter({
      from: 0,
      to: rollFrames,
      duration: 600,
      ease: 'Cubic.Out',
      onUpdate: (tween) => {
        const v = Math.floor(tween.getValue());
        const face = (v % 6) + 1;
        this.diceGraphics.clear();
        drawDiceFace(this.diceGraphics, cx, cy, diceSize, face, 0xf5f5f5);
      },
      onComplete: () => {
        this.diceGraphics.clear();
        drawDiceFace(this.diceGraphics, cx, cy, diceSize, roll, 0xf5f5f5);
        this.diceResult = roll;

        if (result.won) {
          this.combatText.setText(`Victory! ${roll} + ${this.playerAttackBonus} >= ${result.monsterDefense}`);
          this.showFloatingDamage(cx, cy - 80, 'VICTORY!', '#00ff88');
          this.time.delayedCall(400, () => {
            const idx = this.monsters.indexOf(monster);
            this.monsters.splice(idx, 1);
            monster.sprite?.destroy();
            this.applyReward(result.reward);
            this.endCombat();
          });
        } else if (result.monsterEffect === 'skeleton_shield') {
          monster.hasShield = false;
          this.monsterDefenseText.setText(`Defense: ${getMonsterDefense(monster.type)} | Your Atk+: ${this.playerAttackBonus}`);
          this.combatHintText.setText(getMonsterHint(monster.type, false));
          this.combatText.setText('Shield broken! Roll again to finish it.');
          this.showFloatingDamage(cx, cy - 80, 'SHIELD!', '#8888ff');
          this.rollingDice = false;
          this.rollButton.setVisible(true);
          this.rollButton.setInteractive();
        } else {
          if (this.playerShield > 0) {
            this.playerShield--;
            this.combatText.setText(`Shield absorbed! ${roll} < ${result.monsterDefense}`);
            this.showFloatingDamage(cx, cy - 80, 'BLOCKED', '#8888ff');
          } else {
            this.playerHp = Math.max(0, this.playerHp - result.damage);
            this.combatText.setText(`Hit! -${result.damage} HP. ${roll} < ${result.monsterDefense}`);
            this.showFloatingDamage(cx, cy - 80, `-${result.damage}`, '#ff4444');
            this.screenShake(12);
          }
          this.time.delayedCall(1200, () => this.endCombat());
        }
      },
    });
  }

  private endCombat() {
    this.rollingDice = false;
    this.inCombat = false;
    this.currentCombatMonster = null;
    this.combatResult = null;
    this.combatPanel.setVisible(false);
    this.diceGraphics.setVisible(false);
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
      this.scale.height - 160,
      '',
      { ...style, fontSize: '16px', align: 'center' }
    );
    this.combatText.setOrigin(0.5, 0);

    this.rollButton = this.add
      .text(this.scale.width / 2, this.scale.height - 50, 'ROLL DICE', {
        ...style,
        fontSize: '20px',
        backgroundColor: '#00ff88',
        color: '#0a0a0f',
      })
      .setPadding(20, 10)
      .setOrigin(0.5, 0)
      .setInteractive({ useHandCursor: true })
      .setVisible(false);

    this.rollButton.on('pointerover', () => {
      if (this.rollButton.visible) this.rollButton.setScale(1.05);
    });
    this.rollButton.on('pointerout', () => this.rollButton.setScale(1));
    this.rollButton.on('pointerdown', () => {
      if (!this.rollingDice && this.inCombat) this.doCombatRoll();
    });

    this.input.keyboard?.on('keydown-R', () => this.scene.restart());
    this.input.keyboard?.on('keydown-SPACE', (e: KeyboardEvent) => {
      e.preventDefault();
      if (!this.rollingDice && this.inCombat) this.doCombatRoll();
    });
    this.input.keyboard?.on('keydown-ENTER', (e: KeyboardEvent) => {
      e.preventDefault();
      if (!this.rollingDice && this.inCombat) this.doCombatRoll();
    });
  }

  private updateUI() {
    this.uiText.setText(
      `HP: ${this.playerHp} | Shield: ${this.playerShield} | Atk+: ${this.playerAttackBonus}\n` +
        `Monsters: ${this.monsters.length} | WASD/Arrows to move | R = Restart`
    );
  }
}
