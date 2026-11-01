/* Americano-Spielplan: Jeder spielt mit möglichst jedem einmal zusammen und
   gegen alle etwa gleich oft. Pausen werden gleichmässig verteilt. */
(function (root) {
  const SEARCH_MS = 350;
  const PARTNER_WEIGHT = 40;
  const OPPONENT_WEIGHT = 3;
  const MAX_DEFAULT_ROUNDS = 16;
  const START_TEMPERATURE = 30;
  const END_TEMPERATURE = 0.5;
  const COOLING = 0.9999;

  function maxCourts(playerCount) {
    return Math.floor(playerCount / 4);
  }

  /** Runden, bei denen alle gleich viele Spiele haben. */
  function isFair(playerCount, courts, rounds) {
    return (rounds * courts * 4) % playerCount === 0;
  }

  /** Spiele pro Spieler (Durchschnitt, ganzzahlig wenn die Rundenzahl fair ist). */
  function gamesPerPlayer(playerCount, courts, rounds) {
    return (rounds * courts * 4) / playerCount;
  }

  /** Faire Rundenzahl, bei der jeder möglichst einmal mit jedem zusammenspielt. */
  function recommendedRounds(playerCount, courts) {
    const target = ((playerCount - 1) * playerCount) / (4 * courts);
    let best = null;
    for (let r = 1; r <= MAX_DEFAULT_ROUNDS; r++) {
      if (!isFair(playerCount, courts, r)) continue;
      if (best === null || Math.abs(r - target) < Math.abs(best - target)) best = r;
    }
    return best === null ? Math.ceil(target) : best;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, random) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* Pausen in Durchgängen verteilen: in jedem Durchgang pausieren alle genau
     einmal. Neu gemischt, damit sich nicht immer dieselben Gruppen abwechseln. */
  function buildByes(playerCount, courts, rounds, random) {
    const byeCount = playerCount - courts * 4;
    const avoidBackToBack = byeCount * 3 <= playerCount;
    const everyone = [...Array(playerCount).keys()];
    const byes = [];
    let queue = [];
    let previous = [];

    function nextPass(sitting) {
      let order = [];
      for (let attempt = 0; attempt < 30; attempt++) {
        const mixed = shuffle(everyone, random);
        order = [
          ...mixed.filter((p) => !sitting.includes(p)),
          ...mixed.filter((p) => sitting.includes(p)),
        ];
        const next = order.slice(0, byeCount - sitting.length);
        if (!avoidBackToBack || !next.some((p) => previous.includes(p))) break;
      }
      return order;
    }

    for (let r = 0; r < rounds; r++) {
      const sitting = [];
      while (sitting.length < byeCount) {
        if (queue.length === 0) queue = nextPass(sitting);
        sitting.push(queue.shift());
      }
      byes.push(sitting);
      previous = sitting;
    }
    return byes;
  }

  /* Eine Runde ist eine flache Liste: [a, b, c, d, ...] mit den Teams
     (a,b) gegen (c,d), die nächsten vier Plätze sind der nächste Court. */
  const matchStart = (i) => i - (i % 4);

  function totalCost(counts, n, idealPartner, idealOpponent) {
    let cost = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dp = counts.partners[i * n + j] - idealPartner;
        const dq = counts.opponents[i * n + j] - idealOpponent;
        cost += PARTNER_WEIGHT * dp * dp + OPPONENT_WEIGHT * dq * dq;
      }
    }
    return cost;
  }

  function freshCounts(rounds, n) {
    const counts = { partners: new Int16Array(n * n), opponents: new Int16Array(n * n) };
    for (const round of rounds) {
      for (let m = 0; m < round.length; m += 4) {
        const [a, b, c, d] = [round[m], round[m + 1], round[m + 2], round[m + 3]];
        for (const [x, y] of [[a, b], [c, d]]) {
          counts.partners[x * n + y]++;
          counts.partners[y * n + x]++;
        }
        for (const x of [a, b]) {
          for (const y of [c, d]) {
            counts.opponents[x * n + y]++;
            counts.opponents[y * n + x]++;
          }
        }
      }
    }
    return counts;
  }

  function applyMatch(counts, round, m, delta, n) {
    const [a, b, c, d] = [round[m], round[m + 1], round[m + 2], round[m + 3]];
    for (const [x, y] of [[a, b], [c, d]]) {
      counts.partners[x * n + y] += delta;
      counts.partners[y * n + x] += delta;
    }
    for (const x of [a, b]) {
      for (const y of [c, d]) {
        counts.opponents[x * n + y] += delta;
        counts.opponents[y * n + x] += delta;
      }
    }
  }

  function swapSlots(counts, round, i, j, n) {
    const first = matchStart(i);
    const second = matchStart(j);
    applyMatch(counts, round, first, -1, n);
    if (second !== first) applyMatch(counts, round, second, -1, n);
    [round[i], round[j]] = [round[j], round[i]];
    applyMatch(counts, round, first, 1, n);
    if (second !== first) applyMatch(counts, round, second, 1, n);
  }

  /* Simulated Annealing: tauscht Spieler innerhalb einer Runde, bis die Zeit um ist. */
  function search(rounds, n, random, deadline, now) {
    const slots = rounds[0].length;
    const pairs = (n * (n - 1)) / 2;
    const idealPartner = (rounds.length * slots) / 2 / pairs;
    const idealOpponent = (rounds.length * slots) / pairs;
    const counts = freshCounts(rounds, n);
    let cost = totalCost(counts, n, idealPartner, idealOpponent);
    let best = rounds.map((r) => r.slice());
    let bestCost = cost;
    let temperature = START_TEMPERATURE;

    for (let step = 0; ; step++) {
      if (step % 256 === 0 && now() > deadline) break;
      temperature *= COOLING;
      if (temperature < END_TEMPERATURE) temperature = START_TEMPERATURE;

      const round = rounds[Math.floor(random() * rounds.length)];
      const i = Math.floor(random() * slots);
      const j = Math.floor(random() * slots);
      if (i === j) continue;

      swapSlots(counts, round, i, j, n);
      const nextCost = totalCost(counts, n, idealPartner, idealOpponent);
      const delta = nextCost - cost;
      if (delta <= 0 || random() < Math.exp(-delta / temperature)) {
        cost = nextCost;
        if (cost < bestCost - 1e-9) {
          bestCost = cost;
          best = rounds.map((r) => r.slice());
        }
      } else {
        swapSlots(counts, round, i, j, n);
      }
    }
    return { rounds: best, cost: bestCost };
  }

  /**
   * Erstellt den Spielplan.
   * @returns {{rounds: {matches: {teamA:number[], teamB:number[], court:number}[], byes:number[]}[]}}
   */
  function generateSchedule(playerCount, courts, roundCount, seed, options) {
    const random = mulberry32(seed);
    const now = (options && options.now) || (() => Date.now());
    const budget = (options && options.budgetMs) || SEARCH_MS;
    const byes = buildByes(playerCount, courts, roundCount, random);
    const flatRounds = byes.map((sitting) => {
      const out = new Set(sitting);
      return shuffle([...Array(playerCount).keys()].filter((p) => !out.has(p)), random);
    });

    const { rounds } = search(flatRounds, playerCount, random, now() + budget, now);

    return {
      rounds: rounds.map((flat, r) => {
        const matches = [];
        for (let m = 0; m < flat.length; m += 4) {
          matches.push({
            court: m / 4 + 1,
            teamA: [flat[m], flat[m + 1]],
            teamB: [flat[m + 2], flat[m + 3]],
          });
        }
        return { matches, byes: byes[r] };
      }),
    };
  }

  /** Kennzahlen zur Qualität eines Spielplans. */
  function scheduleStats(schedule, playerCount) {
    const n = playerCount;
    const flat = schedule.rounds.map((r) =>
      r.matches.flatMap((m) => [...m.teamA, ...m.teamB])
    );
    const counts = freshCounts(flat, n);
    const games = new Array(n).fill(0);
    flat.forEach((round) => round.forEach((p) => games[p]++));
    let maxPartner = 0;
    let maxOpponent = 0;
    let unmetPartners = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        maxPartner = Math.max(maxPartner, counts.partners[i * n + j]);
        maxOpponent = Math.max(maxOpponent, counts.opponents[i * n + j]);
        if (counts.partners[i * n + j] === 0) unmetPartners++;
      }
    }
    return { games, maxPartner, maxOpponent, unmetPartners };
  }

  /**
   * Tabelle aus den Resultaten. results["r-m"] = {a: Punkte Team A, b: Punkte Team B}.
   * Rang: Punkte, dann Differenz, dann Siege. Bei "avg": Punkte pro Spiel.
   */
  function standings(players, schedule, results, sortBy) {
    const rows = players.map((name, index) => ({
      index, name, games: 0, wins: 0, draws: 0, losses: 0, points: 0, against: 0,
    }));
    schedule.rounds.forEach((round, r) => {
      round.matches.forEach((match, m) => {
        const result = results[`${r}-${m}`];
        if (!result) return;
        for (const [team, own, other] of [
          [match.teamA, result.a, result.b],
          [match.teamB, result.b, result.a],
        ]) {
          for (const p of team) {
            const row = rows[p];
            row.games++;
            row.points += own;
            row.against += other;
            if (own > other) row.wins++;
            else if (own < other) row.losses++;
            else row.draws++;
          }
        }
      });
    });
    const value = (row) =>
      sortBy === 'avg' ? (row.games ? row.points / row.games : 0) : row.points;
    rows.forEach((row) => {
      row.diff = row.points - row.against;
      row.avg = row.games ? row.points / row.games : 0;
    });
    rows.sort(
      (x, y) =>
        value(y) - value(x) ||
        y.diff - x.diff ||
        y.wins - x.wins ||
        x.name.localeCompare(y.name, 'de')
    );
    /* Wer in allen Wertungen gleichauf ist, teilt sich den Rang. */
    rows.forEach((row, i) => {
      const prev = rows[i - 1];
      const tied = prev && value(prev) === value(row) && prev.diff === row.diff && prev.wins === row.wins;
      row.rank = tied ? prev.rank : i + 1;
    });
    return rows;
  }

  const api = {
    maxCourts, isFair, gamesPerPlayer, recommendedRounds,
    generateSchedule, scheduleStats, standings,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Americano = api;
})(typeof window !== 'undefined' ? window : globalThis);
