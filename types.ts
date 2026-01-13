export interface Point {
  x: number;
  y: number;
}

export enum DroneType {
  INTERCEPTOR = 'INTERCEPTOR',
  BOMBER = 'BOMBER'
}

export interface GroundAsset {
  id: string;
  x: number;
  y: number;
  health: number;
}

export interface SimStats {
  friendlyCount: number;
  hostileCount: number;
  friendlyBomberCount: number;
  hostileBomberCount: number;
  assetsRemaining: number;
}