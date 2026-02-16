export const BOT_METADATA = {
  scoringWeights: {
    trickWinValue: 1.0,
    safetyValue: 0.9,
    futureHandValue: 0.75,
    opponentReadValue: 0.7,
    scorePressure: 0.65,
    penaltyRisk: 1.15,
  },
  heuristics: {
    hearts: {
      queenDangerBoost: 24,
      moonDefenseTrigger: 13,
      earlyHighCardPenalty: 8,
      passDangerBias: 1.2,
    },
    spades: {
      bidProtectionBias: 1.25,
      bagAvoidanceBias: 0.9,
      trumpControlBias: 1.15,
    },
    callbreak: {
      conservativeBidFactor: 0.92,
      trumpPreserveBias: 1.1,
      overtrumpPressureBias: 1.2,
    },
  },
  inferenceRules: [
    'mark_suit_void_when_player_cannot_follow',
    'reduce_high_card_probability_when_opponent_spends_high_early',
    'track_trump_usage_to_estimate_remaining_trump_density',
  ],
} as const;
