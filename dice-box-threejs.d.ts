declare module "@3d-dice/dice-box-threejs" {
  export default class DiceBox {
    constructor(selector: string, options?: Record<string, unknown>);
    roll(notation: string): Promise<unknown>;
  }
}
