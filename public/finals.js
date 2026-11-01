/* Finalrunde nach dem Americano: Rang 1 & 2, 3 & 4 usw. bilden feste Teams.
   Das beste Team spielt gegen das schlechteste. Geht das nicht auf (3, 5 oder
   6 Teams), steigen die besten Teams später ein. Alle Plätze werden ausgespielt. */
(function (root) {
  const MEDAL_BEST_OF = 3;

  const seed = (n) => ({ seed: n });
  const winnerOf = (id) => ({ winner: id });
  const loserOf = (id) => ({ loser: id });

  /** @param {number[]} ranked Spieler-Indizes, bester zuerst. Bei ungerader Zahl bleibt der Letzte übrig. */
  function buildTeams(ranked) {
    const teams = [];
    for (let i = 0; i + 1 < ranked.length; i += 2) teams.push([ranked[i], ranked[i + 1]]);
    return { teams, leftover: ranked.length % 2 ? ranked[ranked.length - 1] : null };
  }

  /* Spiele in Spielreihenfolge: Ein Spiel verweist nur auf frühere Spiele. */
  const LAYOUTS = {
    2: [
      ['final', 'Finale', seed(1), seed(2), { winnerPlace: 1, loserPlace: 2 }],
    ],
    3: [
      ['sf', 'Halbfinale', seed(2), seed(3), { loserPlace: 3 }],
      ['final', 'Finale', seed(1), winnerOf('sf'), { winnerPlace: 1, loserPlace: 2 }],
    ],
    4: [
      ['sf1', 'Halbfinale', seed(1), seed(4), {}],
      ['sf2', 'Halbfinale', seed(2), seed(3), {}],
      ['third', 'Spiel um Platz 3', loserOf('sf1'), loserOf('sf2'), { winnerPlace: 3, loserPlace: 4 }],
      ['final', 'Finale', winnerOf('sf1'), winnerOf('sf2'), { winnerPlace: 1, loserPlace: 2 }],
    ],
    5: [
      ['qf', 'Viertelfinale', seed(4), seed(5), { loserPlace: 5 }],
      ['sf1', 'Halbfinale', seed(1), winnerOf('qf'), {}],
      ['sf2', 'Halbfinale', seed(2), seed(3), {}],
      ['third', 'Spiel um Platz 3', loserOf('sf1'), loserOf('sf2'), { winnerPlace: 3, loserPlace: 4 }],
      ['final', 'Finale', winnerOf('sf1'), winnerOf('sf2'), { winnerPlace: 1, loserPlace: 2 }],
    ],
    6: [
      ['qf1', 'Viertelfinale', seed(3), seed(6), {}],
      ['qf2', 'Viertelfinale', seed(4), seed(5), {}],
      ['fifth', 'Spiel um Platz 5', loserOf('qf1'), loserOf('qf2'), { winnerPlace: 5, loserPlace: 6 }],
      ['sf1', 'Halbfinale', seed(1), winnerOf('qf2'), {}],
      ['sf2', 'Halbfinale', seed(2), winnerOf('qf1'), {}],
      ['third', 'Spiel um Platz 3', loserOf('sf1'), loserOf('sf2'), { winnerPlace: 3, loserPlace: 4 }],
      ['final', 'Finale', winnerOf('sf1'), winnerOf('sf2'), { winnerPlace: 1, loserPlace: 2 }],
    ],
  };

  /** @param {number} bestOf 1 (ein Satz) oder 3 (zwei Gewinnsätze) für alle Spiele ausser Finale und Spiel um Platz 3. */
  function buildBracket(teamCount, bestOf) {
    const layout = LAYOUTS[teamCount];
    return layout.map(([id, stage, a, b, places]) => {
      const sameStage = layout.filter((entry) => entry[1] === stage);
      const number = sameStage.length > 1 ? ` ${sameStage.findIndex((entry) => entry[0] === id) + 1}` : '';
      return {
        id, stage, label: stage + number, a, b, ...places,
        bestOf: id === 'final' || id === 'third' ? MEDAL_BEST_OF : bestOf,
      };
    });
  }

  /**
   * Wertet Sätze aus. Sätze nach der Entscheidung werden ignoriert.
   * @param {(number|null)[][]} sets z. B. [[6, 3], [4, 6], [6, 2]]
   * @returns {{winner: 'a'|'b'|null, sets: number[][], wins: number[], tied: boolean}}
   */
  function decideMatch(bestOf, sets) {
    const needed = (bestOf + 1) / 2;
    const wins = [0, 0];
    const used = [];
    for (const [a, b] of sets) {
      if (a === null || b === null) break;
      if (a === b) return { winner: null, sets: used, wins, tied: true };
      used.push([a, b]);
      wins[a > b ? 0 : 1]++;
      if (wins[0] === needed) return { winner: 'a', sets: used, wins, tied: false };
      if (wins[1] === needed) return { winner: 'b', sets: used, wins, tied: false };
    }
    return { winner: null, sets: used, wins, tied: false };
  }

  function resolveSource(source, resolved) {
    if (source.seed) return source.seed;
    const earlier = resolved[source.winner || source.loser];
    return (source.winner ? earlier.winnerSeed : earlier.loserSeed) || null;
  }

  /** Setzt die Teams ein. results[id] = {teams: [seedA, seedB], sets}. */
  function resolveBracket(bracket, results) {
    const resolved = {};
    return bracket.map((match) => {
      const teamA = resolveSource(match.a, resolved);
      const teamB = resolveSource(match.b, resolved);
      const saved = results[match.id];
      const valid = saved && teamA && teamB && saved.teams[0] === teamA && saved.teams[1] === teamB;
      const outcome = valid ? decideMatch(match.bestOf, saved.sets) : null;
      const winner = outcome && outcome.winner;
      const row = {
        ...match, teamA, teamB,
        result: valid ? saved : null,
        wins: outcome ? outcome.wins : null,
        winner,
        winnerSeed: winner ? (winner === 'a' ? teamA : teamB) : null,
        loserSeed: winner ? (winner === 'a' ? teamB : teamA) : null,
      };
      resolved[match.id] = row;
      return row;
    });
  }

  /** Entfernt Resultate, deren Teams nach einer Änderung nicht mehr stimmen. */
  function pruneResults(bracket, results) {
    const kept = { ...results };
    const removed = [];
    for (const match of bracket) {
      if (!kept[match.id]) continue;
      const row = resolveBracket(bracket, kept).find((entry) => entry.id === match.id);
      if (!row.result) {
        delete kept[match.id];
        removed.push(match.id);
      }
    }
    return { results: kept, removed };
  }

  /** Bereits feststehende Plätze, bester zuerst: [{place, seed}]. */
  function placements(bracket, results) {
    const places = [];
    for (const row of resolveBracket(bracket, results)) {
      if (!row.winner) continue;
      if (row.winnerPlace) places.push({ place: row.winnerPlace, seed: row.winnerSeed });
      if (row.loserPlace) places.push({ place: row.loserPlace, seed: row.loserSeed });
    }
    return places.sort((x, y) => x.place - y.place);
  }

  const api = { buildTeams, buildBracket, decideMatch, resolveBracket, pruneResults, placements };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AmericanoFinals = api;
})(typeof window !== 'undefined' ? window : globalThis);
