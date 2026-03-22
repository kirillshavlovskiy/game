/** Minimal typings for https://sdk.crazygames.com/crazygames-sdk-v3.js (see CrazyGames HTML5 docs). */
export type CrazyGamesEnvironment = "local" | "crazygames" | "disabled";

export interface CrazyGamesGameModule {
  loadingStart(): void;
  loadingStop(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  happytime(): void;
  addSettingsChangeListener(cb: (settings: { muteAudio?: boolean; disableChat?: boolean }) => void): void;
  removeSettingsChangeListener(cb: (settings: { muteAudio?: boolean; disableChat?: boolean }) => void): void;
}

export interface CrazyGamesSDK {
  environment: CrazyGamesEnvironment;
  init(): Promise<void>;
  game: CrazyGamesGameModule;
}

declare global {
  interface Window {
    CrazyGames?: { SDK: CrazyGamesSDK };
  }
}

export {};
