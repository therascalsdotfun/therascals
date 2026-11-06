export type CommunityPreset = {
  id: string;
  title: string;
  code: string;
  creator: { kind: string; address: string };
  createdAt: string;
  published: boolean;
  usage: {
    adoptingWallets: number;
    completedReveals: number;
    qualifiedUses: number;
    executedTrades: number;
  };
};
export type PresetCollection = {
  presets: CommunityPreset[];
  total?: number;
  rewardPolicy: "not_enabled";
};
