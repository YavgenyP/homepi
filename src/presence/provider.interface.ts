export type PresenceSighting = {
  personId: number;
  seenAt: number; // unix timestamp (seconds)
};

export interface PresenceProvider {
  readonly name: string;
  poll(): Promise<PresenceSighting[]>;
}
