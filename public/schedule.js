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

  /* Wie oft jemand pausiert: Wer bisher mehr gespielt hat, pausiert öfter. */
  function plannedByes(active, byeCount, rounds, random, playedGames) {
    const left = new Map(active.map((p) => [p, 0]));
    const projected = new Map(active.map((p) => [p, (playedGames[p] || 0) + rounds]));
    for (let i = 0; i < rounds * byeCount; i++) {
      const open = shuffle(active, random).filter((p) => left.get(p) < rounds);
      const next = open.reduce((a, b) => (projected.get(b) > projected.get(a) ? b : a));
      left.set(next, left.get(next) + 1);
      projected.set(next, projected.get(next) - 1);
    }
    return left;
  }

  /* Pausen in Durchgängen verteilen: in jedem Durchgang pausieren alle, die noch
     dran sind, genau einmal. Neu gemischt, damit sich nicht immer dieselben
     Gruppen abwechseln. */
  function buildByes(active, byeCount, rounds, random, playedGames) {
    const avoidBackToBack = byeCount * 3 <= active.length;
    const left = plannedByes(active, byeCount, rounds, random, playedGames);
    const byes = [];
    let queue = [];
    let previous = [];

    function nextPass(sitting) {
      const pool = active.filter((p) => left.get(p) > 0);
      let order = [];
      for (let attempt = 0; attempt < 30; attempt++) {
        const mixed = shuffle(pool, random);
        order = [
          ...mixed.filter((p) => !sitting.includes(p)),
          ...mixed.filter((p) => sitting.includes(p)),
        ];
        const next = order.slice(0, byeCount - sitting.length);
        if (!avoidBackToBack || !next.some((p) => previous.includes(p))) break;
      }
      pool.forEach((p) => left.set(p, left.get(p) - 1));
      return order;
    }

    for (let r = 0; r < rounds; r++) {
      const sitting = [];
      while (sitting.length < byeCount) {
        if (queue.length === 0) queue = nextPass(sitting);
        const at = queue.findIndex((p) => !sitting.includes(p));
        if (at >= 0) sitting.push(queue.splice(at, 1)[0]);
        else sitting.push(shuffle(active, random).find((p) => !sitting.includes(p)));
      }
      byes.push(sitting);
      previous = sitting;
    }
    return byes;
  }

  /* Eine Runde ist eine flache Liste: [a, b, c, d, ...] mit den Teams
     (a,b) gegen (c,d), die nächsten vier Plätze sind der nächste Court. */
  const matchStart = (i) => i - (i % 4);

  function totalCost(counts, pairs, idealPartner, idealOpponent) {
    let cost = 0;
    for (const pair of pairs) {
      const dp = counts.partners[pair] - idealPartner;
      const dq = counts.opponents[pair] - idealOpponent;
      cost += PARTNER_WEIGHT * dp * dp + OPPONENT_WEIGHT * dq * dq;
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

  /* Simulated Annealing: tauscht Spieler innerhalb einer neuen Runde, bis die
     Zeit um ist. Bereits feste Runden (history) zählen mit, ändern sich aber nicht. */
  function search(rounds, history, n, active, random, deadline, now) {
    const slots = rounds[0].length;
    const counts = freshCounts([...history, ...rounds], n);
    const pairs = [];
    active.forEach((a, i) => active.slice(i + 1).forEach((b) => pairs.push(a * n + b)));
    const sum = (table) => pairs.reduce((total, pair) => total + table[pair], 0);
    const idealPartner = sum(counts.partners) / pairs.length;
    const idealOpponent = sum(counts.opponents) / pairs.length;
    let cost = totalCost(counts, pairs, idealPartner, idealOpponent);
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
      const nextCost = totalCost(counts, pairs, idealPartner, idealOpponent);
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

  const flatten = (round) => round.matches.flatMap((m) => [...m.teamA, ...m.teamB]);

  /* Neue Runden für die aktiven Spieler, passend zu den schon festen Runden. */
  function buildRounds(history, n, active, courts, roundCount, seed, options) {
    if (roundCount <= 0) return [];
    const random = mulberry32(seed);
    const now = (options && options.now) || (() => Date.now());
    const budget = (options && options.budgetMs) || SEARCH_MS;
    const flatHistory = history.map(flatten);
    const played = new Array(n).fill(0);
    flatHistory.forEach((round) => round.forEach((p) => played[p]++));
    const byes = buildByes(active, active.length - courts * 4, roundCount, random, played);
    const flatRounds = byes.map((sitting) => {
      const out = new Set(sitting);
      return shuffle(active.filter((p) => !out.has(p)), random);
    });

    const { rounds } = search(flatRounds, flatHistory, n, active, random, now() + budget, now);

    return rounds.map((flat, r) => {
      const matches = [];
      for (let m = 0; m < flat.length; m += 4) {
        matches.push({
          court: m / 4 + 1,
          teamA: [flat[m], flat[m + 1]],
          teamB: [flat[m + 2], flat[m + 3]],
        });
      }
      return { matches, byes: byes[r] };
    });
  }

  /**
   * Erstellt den Spielplan.
   * @returns {{rounds: {matches: {teamA:number[], teamB:number[], court:number}[], byes:number[]}[]}}
   */
  function generateSchedule(playerCount, courts, roundCount, seed, options) {
    const active = [...Array(playerCount).keys()];
    return { rounds: buildRounds([], playerCount, active, courts, roundCount, seed, options) };
  }

  /** Letzte Runde mit eingetragenem Resultat (Index), -1 wenn es noch keine gibt. */
  function lastPlayedRound(results) {
    return Object.keys(results).reduce((last, key) => Math.max(last, Number(key.split('-')[0])), -1);
  }

  /* Behält alle Runden bis zum letzten Resultat. Noch offene Spiele darin
     entfallen, wenn jemand aus dem Turnier ausgeschieden ist. */
  function keepPlayedRounds(schedule, results, removed) {
    const rounds = [];
    const kept = {};
    schedule.rounds.slice(0, lastPlayedRound(results) + 1).forEach((round, r) => {
      const matches = [];
      const byes = round.byes.filter((p) => !removed.includes(p));
      const newRound = rounds.length;
      round.matches.forEach((match, m) => {
        const result = results[`${r}-${m}`];
        const team = [...match.teamA, ...match.teamB];
        if (result || !team.some((p) => removed.includes(p))) {
          if (result) kept[`${newRound}-${matches.length}`] = result;
          matches.push(match);
        } else {
          byes.push(...team.filter((p) => !removed.includes(p)));
        }
      });
      if (matches.length) rounds.push({ matches, byes });
    });
    return { rounds, results: kept };
  }

  /**
   * Passt ein laufendes Turnier an: Gespielte Runden bleiben, der Rest wird neu ausgelost.
   * @param {{playerCount:number, active:number[], courts:number, rounds:number, seed:number}} plan
   */
  function replanSchedule(schedule, results, plan, options) {
    const removed = [...Array(plan.playerCount).keys()].filter((p) => !plan.active.includes(p));
    const kept = keepPlayedRounds(schedule, results, removed);
    const fresh = buildRounds(
      kept.rounds, plan.playerCount, plan.active, plan.courts, plan.rounds - kept.rounds.length, plan.seed, options
    );
    return { schedule: { rounds: [...kept.rounds, ...fresh] }, results: kept.results };
  }

  /** Kommen alle am Ende auf gleich viele Spiele? Gibt die Zahl zurück, sonst null. */
  function equalGamesAfter(playedGames, courts, newRounds) {
    const total = playedGames.reduce((sum, games) => sum + games, 0) + newRounds * courts * 4;
    const games = total / playedGames.length;
    const possible = Number.isInteger(games) && playedGames.every((g) => g <= games && games <= g + newRounds);
    return possible ? games : null;
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
   * Ausgeschiedene (inactive) erscheinen nur, wenn sie schon gespielt haben.
   */
  function standings(players, schedule, results, sortBy, inactive) {
    const all = players.map((name, index) => ({
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
            const row = all[p];
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
    const rows = all.filter((row) => row.games > 0 || !(inactive || []).includes(row.index));
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
    generateSchedule, replanSchedule, keepPlayedRounds, lastPlayedRound, equalGamesAfter,
    scheduleStats, standings,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Americano = api;
})(typeof window !== 'undefined' ? window : globalThis);
