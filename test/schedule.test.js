const test = require('node:test');
const assert = require('node:assert');
const {
  maxCourts, isFair, recommendedRounds, generateSchedule, scheduleStats, standings,
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
