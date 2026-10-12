import { createGame, startGame, assertState, def } from "./engine.js";
import { runAITurn } from "./ai.js";
onmessage = ({ data }) => {
  const report = {
    completed: 0,
    wins: { N: 0, W: 0 },
    draws: 0,
    timeouts: 0,
    totalTurns: 0,
    errors: [],
    averageTurns: 0,
  };
  for (let i = 0; i < data.games; i++) {
    try {
      const s = createGame({ faction: i % 2 ? "N" : "W", seed: i + 1 });
      startGame(
        s,
        s.players[0].hand.filter((h) => def(h).cost >= 5).map((h) => h.uid),
      );
      while (s.phase === "play" && s.seq < 180) {
        runAITurn(s);
        assertState(s);
      }
      if (s.winner === null) report.timeouts++;
      else if (s.winner === "draw") report.draws++;
      else report.wins[s.players[s.winner].faction]++;
      report.totalTurns += s.seq;
    } catch (e) {
      report.errors.push(`Seed ${i + 1}: ${e.message}`);
    }
    report.completed++;
    report.averageTurns = +(report.totalTurns / report.completed).toFixed(1);
    if (i % 5 === 0 || i === data.games - 1) postMessage(report);
  }
};
