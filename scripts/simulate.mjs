import { createGame, startGame, assertState, def } from "../src/game/engine.js";
import { runAITurn } from "../src/game/ai.js";
const games = Number(process.argv[2] ?? 100);
const report = {
  games,
  wins: { N: 0, W: 0 },
  draws: 0,
  timeouts: 0,
  maxTurn: 0,
  totalTurns: 0,
  errors: [],
};
for (let i = 0; i < games; i++) {
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
    report.maxTurn = Math.max(report.maxTurn, s.seq);
    report.totalTurns += s.seq;
  } catch (e) {
    report.errors.push({ seed: i + 1, error: e.stack });
  }
}
report.averageTurns = +(report.totalTurns / games).toFixed(2);
console.log(JSON.stringify(report, null, 2));
if (report.errors.length || report.timeouts) process.exitCode = 1;
