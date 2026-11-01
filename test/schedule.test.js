const test = require('node:test');
const assert = require('node:assert');
const {
  maxCourts, isFair, recommendedRounds, generateSchedule, replanSchedule, keepPlayedRounds,
  lastPlayedRound, equalGamesAfter, scheduleStats, standings,
} = require('../public/schedule.js');

function everyConfig() {
  const out = [];
  for (let n = 4; n <= 12; n++) {
    for (let c = 1; c <= maxCourts(n); c++) out.push([n, c, recommendedRounds(n, c)]);
  }
  return out;
}

for (const [n, c, r] of everyConfig()) {
  test(`${n} Spieler, ${c} Court(s), ${r} Runden`, () => {
    const schedule = generateSchedule(n, c, r, n * 100 + c, { budgetMs: 150 });
    assert.strictEqual(schedule.rounds.length, r);
    assert.ok(isFair(n, c, r), 'Empfehlung muss fair sein');

    for (const round of schedule.rounds) {
      const seen = round.matches.flatMap((m) => [...m.teamA, ...m.teamB]).concat(round.byes);
      assert.strictEqual(round.matches.length, c);
      assert.strictEqual(round.byes.length, n - c * 4);
      assert.deepStrictEqual([...seen].sort((a, b) => a - b), [...Array(n).keys()]);
    }

    const stats = scheduleStats(schedule, n);
    assert.strictEqual(Math.min(...stats.games), Math.max(...stats.games), 'gleich viele Spiele');
    console.log(`  ${n}/${c}: ${r} Runden, ${stats.games[0]} Spiele pro Person, ` +
      `max. ${stats.maxPartner}× Partner, max. ${stats.maxOpponent}× Gegner, ` +
      `${stats.unmetPartners} Paare nie zusammen`);
  });
}

test('Partner-perfekter Plan bei 4, 5, 8, 9 und 12 Spielern', () => {
  for (const n of [4, 5, 8, 9, 12]) {
    const c = maxCourts(n);
    const stats = scheduleStats(generateSchedule(n, c, recommendedRounds(n, c), 7, { budgetMs: 350 }), n);
    assert.strictEqual(stats.maxPartner, 1, `${n}: niemand doppelt als Partner`);
    assert.strictEqual(stats.unmetPartners, 0, `${n}: jeder mit jedem`);
  }
});

test('Pausen sind gleichmässig verteilt', () => {
  const schedule = generateSchedule(10, 2, 10, 3, { budgetMs: 50 });
  const byes = new Array(10).fill(0);
  schedule.rounds.forEach((round) => round.byes.forEach((p) => byes[p]++));
  assert.strictEqual(Math.max(...byes) - Math.min(...byes), 0);
});

test('Tabelle zählt Punkte, Differenz und Siege', () => {
  const players = ['A', 'B', 'C', 'D'];
  const schedule = {
    rounds: [
      { byes: [], matches: [{ court: 1, teamA: [0, 1], teamB: [2, 3] }] },
      { byes: [], matches: [{ court: 1, teamA: [0, 2], teamB: [1, 3] }] },
    ],
  };
  const rows = standings(players, schedule, { '0-0': { a: 15, b: 9 }, '1-0': { a: 12, b: 12 } });
  const a = rows.find((row) => row.name === 'A');
  const d = rows.find((row) => row.name === 'D');
  assert.deepStrictEqual([a.points, a.diff, a.wins, a.draws, a.losses, a.games], [27, 6, 1, 1, 0, 2]);
  assert.deepStrictEqual([d.points, d.diff, d.wins, d.draws, d.losses], [21, -6, 0, 1, 1]);
  assert.strictEqual(rows[0].name, 'A');
  assert.strictEqual(rows[3].name, 'D');
});

test('Punktgleiche ohne Unterschied teilen sich den Rang', () => {
  const rows = standings(['A', 'B'], { rounds: [] }, {});
  assert.deepStrictEqual(rows.map((row) => row.rank), [1, 1]);
});

test('Ø-Wertung gleicht unterschiedliche Spielzahl aus', () => {
  const players = ['A', 'B', 'C', 'D', 'E'];
  const schedule = {
    rounds: [
      { byes: [4], matches: [{ court: 1, teamA: [0, 1], teamB: [2, 3] }] },
      { byes: [0], matches: [{ court: 1, teamA: [4, 1], teamB: [2, 3] }] },
    ],
  };
  const results = { '0-0': { a: 13, b: 11 }, '1-0': { a: 20, b: 4 } };
  assert.strictEqual(standings(players, schedule, results, 'avg')[0].name, 'E');
  assert.strictEqual(standings(players, schedule, results)[0].name, 'B');
});

function validRound(round, active) {
  const seen = round.matches.flatMap((m) => [...m.teamA, ...m.teamB]).concat(round.byes);
  assert.deepStrictEqual([...seen].sort((a, b) => a - b), [...active].sort((a, b) => a - b));
}

function playRounds(schedule, count) {
  const results = {};
  for (let r = 0; r < count; r++) {
    schedule.rounds[r].matches.forEach((_, m) => { results[`${r}-${m}`] = { a: 14, b: 10 }; });
  }
  return results;
}

test('Anpassen: gespielte Runden und Resultate bleiben unverändert', () => {
  const schedule = generateSchedule(8, 2, 7, 11, { budgetMs: 50 });
  const results = playRounds(schedule, 3);
  const plan = { playerCount: 8, active: [...Array(8).keys()], courts: 1, rounds: 10, seed: 2 };
  const next = replanSchedule(schedule, results, plan, { budgetMs: 50 });
  assert.deepStrictEqual(next.results, results);
  assert.deepStrictEqual(next.schedule.rounds.slice(0, 3), schedule.rounds.slice(0, 3));
  assert.strictEqual(next.schedule.rounds.length, 10);
  next.schedule.rounds.slice(3).forEach((round) => {
    assert.strictEqual(round.matches.length, 1);
    validRound(round, plan.active);
  });
});

test('Anpassen: Neue spielen mit und holen Spiele auf', () => {
  const schedule = generateSchedule(8, 2, 7, 12, { budgetMs: 50 });
  const results = playRounds(schedule, 2);
  const active = [...Array(9).keys()];
  const next = replanSchedule(schedule, results, { playerCount: 9, active, courts: 2, rounds: 9, seed: 3 }, { budgetMs: 80 });
  next.schedule.rounds.slice(2).forEach((round) => validRound(round, active));
  const { games } = scheduleStats(next.schedule, 9);
  assert.ok(Math.max(...games) - Math.min(...games) <= 2, `Spiele: ${games}`);
  assert.strictEqual(games[8], 7, 'Neuer spielt jede neue Runde');
});

test('Anpassen: Ausgeschiedene behalten Punkte, spielen aber nicht mehr', () => {
  const schedule = generateSchedule(8, 2, 7, 13, { budgetMs: 50 });
  const results = playRounds(schedule, 2);
  const active = [0, 1, 2, 3, 4, 5, 6];
  const next = replanSchedule(schedule, results, { playerCount: 8, active, courts: 1, rounds: 7, seed: 4 }, { budgetMs: 50 });
  next.schedule.rounds.slice(2).forEach((round) => validRound(round, active));
  const players = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const gone = standings(players, next.schedule, next.results, 'points', [7]).find((row) => row.index === 7);
  assert.strictEqual(gone.games, 2);
});

test('Anpassen: offenes Spiel einer begonnenen Runde entfällt ohne Resultatverlust', () => {
  const schedule = generateSchedule(8, 2, 3, 14, { budgetMs: 30 });
  const results = { '0-1': { a: 15, b: 9 } };
  const removed = schedule.rounds[0].matches[0].teamA[0];
  const { rounds, results: kept } = keepPlayedRounds(schedule, results, [removed]);
  assert.strictEqual(rounds[0].matches.length, 1);
  assert.deepStrictEqual(rounds[0].matches[0], schedule.rounds[0].matches[1]);
  assert.deepStrictEqual(kept, { '0-0': { a: 15, b: 9 } });
  assert.strictEqual(rounds[0].byes.length, 3);
});

test('Spieler ohne Spiel erscheint nach dem Ausscheiden nicht mehr', () => {
  const rows = standings(['A', 'B'], { rounds: [] }, {}, 'points', [1]);
  assert.deepStrictEqual(rows.map((row) => row.name), ['A']);
});

test('lastPlayedRound und equalGamesAfter', () => {
  assert.strictEqual(lastPlayedRound({}), -1);
  assert.strictEqual(lastPlayedRound({ '0-0': {}, '4-1': {} }), 4);
  assert.strictEqual(equalGamesAfter([2, 2, 2, 2], 1, 2), 4);
  assert.strictEqual(equalGamesAfter([2, 2, 2, 0, 0], 1, 1), null);
  assert.strictEqual(equalGamesAfter([3, 3, 3, 3, 0], 1, 2), null, 'Neuer käme nicht auf 4 Spiele');
  assert.strictEqual(equalGamesAfter([3, 3, 3, 3, 0], 1, 12), 12);
});
