const test = require('node:test');
const assert = require('node:assert');
const {
  buildTeams, buildBracket, decideMatch, resolveBracket, pruneResults, placements,
} = require('../public/finals.js');

/* Spielt den ganzen Baum: Das Team mit der kleineren Nummer gewinnt. */
function playAll(bracket) {
  const results = {};
  for (const match of bracket) {
    const row = resolveBracket(bracket, results).find((entry) => entry.id === match.id);
    assert.ok(row.teamA && row.teamB, `${match.id} hat beide Teams`);
    const aWins = row.teamA < row.teamB;
    const sets = match.bestOf === 1
      ? [aWins ? [6, 2] : [2, 6]]
      : [aWins ? [6, 2] : [2, 6], aWins ? [6, 3] : [3, 6]];
    results[match.id] = { teams: [row.teamA, row.teamB], sets };
  }
  return results;
}

test('Teams: 1&2, 3&4; bei ungerader Zahl bleibt der Letzte übrig', () => {
  assert.deepStrictEqual(buildTeams([5, 2, 7, 0]), { teams: [[5, 2], [7, 0]], leftover: null });
  assert.deepStrictEqual(buildTeams([5, 2, 7, 0, 3]), { teams: [[5, 2], [7, 0]], leftover: 3 });
});

for (const teamCount of [2, 3, 4, 5, 6]) {
  for (const bestOf of [1, 3]) {
    test(`${teamCount} Teams, Best of ${bestOf}: alle Plätze werden ausgespielt`, () => {
      const bracket = buildBracket(teamCount, bestOf);
      const places = placements(bracket, playAll(bracket));
      assert.deepStrictEqual(places.map((p) => p.place), [...Array(teamCount).keys()].map((i) => i + 1));
      assert.deepStrictEqual([...places.map((p) => p.seed)].sort(), [...Array(teamCount).keys()].map((i) => i + 1));
      assert.strictEqual(places[0].seed, 1);

      assert.strictEqual(bracket[bracket.length - 1].id, 'final', 'Finale zuletzt');
      for (const match of bracket) {
        const medal = match.id === 'final' || match.id === 'third';
        assert.strictEqual(match.bestOf, medal ? 3 : bestOf, `${match.id}: Satzformat`);
      }
    });
  }
}

test('4 Teams: 1 gegen 4 und 2 gegen 3', () => {
  const rows = resolveBracket(buildBracket(4, 1), {});
  assert.deepStrictEqual([rows[0].teamA, rows[0].teamB], [1, 4]);
  assert.deepStrictEqual([rows[1].teamA, rows[1].teamB], [2, 3]);
});

test('6 Teams: 1 und 2 steigen im Halbfinale ein, Bessere treffen auf schwächere Sieger', () => {
  const bracket = buildBracket(6, 1);
  const rows = resolveBracket(bracket, playAll(bracket));
  const pair = (id) => {
    const row = rows.find((entry) => entry.id === id);
    return [row.teamA, row.teamB];
  };
  assert.deepStrictEqual(pair('qf1'), [3, 6]);
  assert.deepStrictEqual(pair('qf2'), [4, 5]);
  assert.deepStrictEqual(pair('fifth'), [6, 5]);
  assert.deepStrictEqual(pair('sf1'), [1, 4]);
  assert.deepStrictEqual(pair('sf2'), [2, 3]);
});

test('Satzwertung', () => {
  assert.strictEqual(decideMatch(1, [[6, 3]]).winner, 'a');
  assert.strictEqual(decideMatch(3, [[6, 3]]).winner, null);
  assert.strictEqual(decideMatch(3, [[6, 3], [4, 6]]).winner, null);
  assert.strictEqual(decideMatch(3, [[6, 3], [4, 6], [2, 6]]).winner, 'b');
  assert.deepStrictEqual(decideMatch(3, [[6, 3], [6, 4], [1, 6]]).sets, [[6, 3], [6, 4]], 'Satz nach Entscheidung zählt nicht');
  assert.strictEqual(decideMatch(1, [[6, 6]]).tied, true);
  assert.strictEqual(decideMatch(3, [[6, null]]).winner, null);
});

test('Geändertes Resultat löscht nur betroffene Folgespiele', () => {
  const bracket = buildBracket(4, 1);
  const results = playAll(bracket);
  const changed = { ...results, sf1: { teams: [1, 4], sets: [[2, 6]] } };
  const pruned = pruneResults(bracket, changed);
  assert.deepStrictEqual(pruned.removed.sort(), ['final', 'third']);
  assert.ok(pruned.results.sf2);

  const same = pruneResults(bracket, { ...results, sf1: { teams: [1, 4], sets: [[7, 5]] } });
  assert.deepStrictEqual(same.removed, [], 'gleicher Sieger: nichts löschen');
});
