import type { SearchStrategy } from "./strategies";
import type { JudgeVerdict } from "./judge";

type ScoreEntry = {
  wins: number;
  plays: number;
  runnerUpFinishes: number;
  placements: number[];
};

export class Scoreboard {
  private stats = new Map<string, ScoreEntry>();

  constructor(strategies: SearchStrategy[]) {
    for (const strategy of strategies) {
      this.stats.set(strategy.id, { wins: 0, plays: 0, runnerUpFinishes: 0, placements: [] });
    }
  }

  record(verdict: JudgeVerdict): void {
    for (const row of verdict.scoreboard) {
      const entry = this.stats.get(row.strategy);
      if (!entry) {
        continue;
      }
      entry.plays += 1;
      entry.placements.push(row.placement);
      if (row.placement === 1) {
        entry.wins += 1;
      } else if (row.placement === 2) {
        entry.runnerUpFinishes += 1;
      }
    }
  }

  render(): void {
    const rows = Array.from(this.stats.entries()).map(([strategyId, entry]) => {
      const averagePlacement = entry.placements.length > 0 ? entry.placements.reduce((acc, value) => acc + value, 0) / entry.placements.length : 0;
      const winRate = entry.plays > 0 ? entry.wins / entry.plays : 0;
      return {
        strategyId,
        wins: entry.wins,
        plays: entry.plays,
        winRate,
        runnerUpFinishes: entry.runnerUpFinishes,
        averagePlacement,
      };
    });

    rows.sort((a, b) => {
      if (b.wins !== a.wins) {
        return b.wins - a.wins;
      }
      if (a.averagePlacement !== b.averagePlacement) {
        return a.averagePlacement - b.averagePlacement;
      }
      return b.winRate - a.winRate;
    });

    console.log("\n🏁 Strategy Scoreboard");
    console.log("Strategy           | Wins | Plays | Win%  | Avg Place | 2nd");
    console.log("──────────────────┼──────┼───────┼──────┼──────────┼────");
    for (const row of rows) {
      const winPercent = (row.winRate * 100).toFixed(1).padStart(4, " ");
      const avgPlacement = row.plays > 0 ? row.averagePlacement.toFixed(2).padStart(6, " ") : "  N/A";
      console.log(
        `${row.strategyId.padEnd(18, " ")} | ${String(row.wins).padStart(4, " ")} | ${String(row.plays).padStart(5, " ")} | ${winPercent}% | ${avgPlacement} | ${String(row.runnerUpFinishes).padStart(2, " ")}`,
      );
    }
  }
}
