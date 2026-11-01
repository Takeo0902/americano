(function () {
  const { maxCourts, isFair, gamesPerPlayer, recommendedRounds, generateSchedule, standings } = window.Americano;

  const STORAGE_KEY = 'americano.v1';
  const MIN_PLAYERS = 4;
  const MAX_PLAYERS = 12;
  const MAX_ROUNDS = 30;
  const POINT_OPTIONS = [16, 21, 24, 32];
  const EXAMPLE_NAMES = ['Anna', 'Ben', 'Carla', 'David', 'Elena', 'Fabio', 'Gina', 'Hugo'];

  const view = document.getElementById('view');
  const scoreSheet = document.getElementById('score-sheet');
  const confirmSheet = document.getElementById('confirm-sheet');

  let state = load() || {
    /* courts und rounds: null heisst "automatisch passend zur Spielerzahl". */
    draft: { names: ['', '', '', ''], courts: null, points: 24, rounds: null },
    tournament: null,
    sortBy: null,
  };
  let tab = ['spieler', 'spielplan', 'tabelle'].includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : state.tournament ? 'spielplan' : 'spieler';
  let scoreDraft = null;
  let pendingConfirm = null;

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      return null;
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* Ohne Speicher läuft die App weiter, verliert aber beim Schliessen den Stand. */
    }
  }

  const esc = (text) =>
    String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const title = (text) => `<h1>${esc(text)}<i>.</i></h1>`;
  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

  /* ---------- Einstellungen vor dem Turnier ---------- */

  function draftConfig() {
    const { draft } = state;
    const names = draft.names.map((name) => name.trim()).filter(Boolean);
    const lower = names.map((name) => name.toLowerCase());
    const duplicates = names.filter((_, i) => lower.indexOf(lower[i]) !== i);
    const count = names.length;
    if (count < MIN_PLAYERS) return { names, count, duplicates, ready: false };
    const limit = maxCourts(count);
    const courts = Math.min(draft.courts || limit, limit);
    const rounds = draft.rounds || recommendedRounds(count, courts);
    return { names, count, duplicates, limit, courts, rounds, ready: duplicates.length === 0 };
  }

  function roundsHint({ count, courts, rounds }) {
    const pause = count - courts * 4;
    const pauseText = pause ? ` Pro Runde pausieren ${pause}.` : '';
    if (isFair(count, courts, rounds)) {
      return `<p class="note">Alle spielen ${plural(gamesPerPlayer(count, courts, rounds), 'Spiel', 'Spiele')}.${pauseText}</p>`;
    }
    let below = rounds;
    while (below > 0 && !isFair(count, courts, below)) below--;
    let above = rounds;
    while (!isFair(count, courts, above)) above++;
    const options = below > 0 ? `${below} oder ${above}` : `${above}`;
    return `<p class="note warn">Nicht alle spielen gleich oft. Gleich viele Spiele gibt es bei ${options} Runden.${pauseText}</p>`;
  }

  function setupOptionsHtml() {
    const config = draftConfig();
    if (config.count < MIN_PLAYERS) {
      const missing = MIN_PLAYERS - config.count;
      return `<div class="actions"><button type="button" class="btn primary" disabled>Noch ${plural(missing, 'Name', 'Namen')} eintragen</button></div>`;
    }
    const courtChips = Array.from({ length: config.limit }, (_, i) => i + 1)
      .map((c) => `<button type="button" class="chip" data-action="courts" data-value="${c}" aria-pressed="${c === config.courts}">${c}</button>`)
      .join('');
    const pointChips = POINT_OPTIONS
      .map((p) => `<button type="button" class="chip" data-action="points" data-value="${p}" aria-pressed="${p === state.draft.points}">${p}</button>`)
      .join('');
    const duplicate = config.duplicates.length
      ? `<p class="note warn">«${esc(config.duplicates[0])}» kommt doppelt vor. Bitte die Namen unterscheidbar machen.</p>`
      : '';
    return `
      <h2>Courts</h2>
      <div class="chips">${courtChips}</div>
      <h2>Punkte pro Spiel</h2>
      <div class="chips">${pointChips}</div>
      <h2>Runden</h2>
      <div class="stepper">
        <button type="button" data-action="rounds" data-value="-1" aria-label="Eine Runde weniger" ${config.rounds <= 1 ? 'disabled' : ''}>−</button>
        <output>${config.rounds}</output>
        <button type="button" data-action="rounds" data-value="1" aria-label="Eine Runde mehr" ${config.rounds >= MAX_ROUNDS ? 'disabled' : ''}>+</button>
      </div>
      ${roundsHint(config)}
      ${duplicate}
      <div class="actions">
        <button type="button" class="btn primary" data-action="start" ${config.ready ? '' : 'disabled'}>Spielplan erstellen</button>
      </div>`;
  }

  function setupHtml() {
    const { names } = state.draft;
    const rows = names
      .map((name, i) => `
        <li class="player-row">
          <span class="nr">${i + 1}</span>
          <input id="player-${i}" data-name="${i}" value="${esc(name)}" maxlength="18"
            placeholder="Name" autocomplete="off" autocapitalize="words" enterkeyhint="next"
            aria-label="Name Spieler ${i + 1}">
          <button type="button" class="remove" data-action="remove" data-value="${i}" aria-label="Spieler ${i + 1} entfernen">×</button>
        </li>`)
      .join('');
    return `
      ${title('Spieler')}
      <p class="lead">Trage 4 bis 12 Personen ein. Der Spielplan mischt die Teams so, dass alle möglichst mit allen spielen.</p>
      <ul class="players">${rows}</ul>
      ${names.length < MAX_PLAYERS ? '<button type="button" class="add-player" data-action="add">+ Spieler hinzufügen</button>' : ''}
      <div class="player-tools">
        <span class="count" id="player-count"></span>
        <button type="button" class="btn-link" id="example-names" data-action="example">Mit Beispielnamen ausprobieren</button>
      </div>
      <div id="setup-options"></div>`;
  }

  function refreshSetupOptions() {
    const options = document.getElementById('setup-options');
    if (!options) return;
    options.innerHTML = setupOptionsHtml();
    const { count } = draftConfig();
    document.getElementById('player-count').textContent = `${count} von ${MAX_PLAYERS} Spielern`;
    document.getElementById('example-names').hidden = count > 0;
  }

  /* ---------- Laufendes Turnier ---------- */

  function tournamentPlayersHtml() {
    const { players, courts, points, schedule } = state.tournament;
    const rows = players
      .map((name, i) => `
        <li class="player-row locked">
          <span class="nr">${i + 1}</span>
          <input id="player-${i}" data-rename="${i}" value="${esc(name)}" maxlength="18"
            autocomplete="off" autocapitalize="words" aria-label="Name Spieler ${i + 1} ändern">
        </li>`)
      .join('');
    return `
      ${title('Spieler')}
      <p class="lead">${players.length} Spieler · ${plural(courts, 'Court', 'Courts')} · ${points} Punkte · ${plural(schedule.rounds.length, 'Runde', 'Runden')}</p>
      <ul class="players">${rows}</ul>
      <p class="note">Namen kannst du jederzeit korrigieren. Für andere Spieler oder Einstellungen startest du ein neues Turnier.</p>
      <div class="actions">
        <button type="button" class="btn" data-action="redraw">Neu auslosen</button>
        <button type="button" class="btn danger" data-action="new">Neues Turnier</button>
      </div>`;
  }

  const roundDone = (r) =>
    state.tournament.schedule.rounds[r].matches.every((_, m) => state.tournament.results[`${r}-${m}`]);

  function currentRound() {
    const { rounds } = state.tournament.schedule;
    for (let r = 0; r < rounds.length; r++) if (!roundDone(r)) return r;
    return -1;
  }

  function matchTotals() {
    const { schedule, results } = state.tournament;
    return {
      total: schedule.rounds.reduce((sum, round) => sum + round.matches.length, 0),
      played: Object.keys(results).length,
    };
  }

  function teamHtml(players, team, side, lost) {
    return `<span class="team team-${side}${lost ? ' lost' : ''}">${team.map((p) => `<span>${esc(players[p])}</span>`).join('')}</span>`;
  }

  function matchHtml(r, m, match) {
    const { players, results } = state.tournament;
    const result = results[`${r}-${m}`];
    const names = (team) => team.map((p) => players[p]).join(' und ');
    const label = `Runde ${r + 1}, Court ${match.court}: ${names(match.teamA)} gegen ${names(match.teamB)}. ` +
      (result ? `Resultat ${result.a} zu ${result.b} ändern` : 'Resultat eintragen');
    const score = result
      ? `<span class="score">${result.a}<i>:</i>${result.b}</span>`
      : '<span class="score-empty">Eintragen</span>';
    return `
      <button type="button" class="match${result ? ' played' : ''}" data-action="score" data-r="${r}" data-m="${m}" aria-label="${esc(label)}">
        <span class="match-court">Court ${match.court}</span>
        ${teamHtml(players, match.teamA, 'a', result && result.a < result.b)}
        ${score}
        ${teamHtml(players, match.teamB, 'b', result && result.b < result.a)}
      </button>`;
  }

  function scheduleHtml() {
    if (!state.tournament) {
      return `
        ${title('Spielplan')}
        <div class="empty">
          <p>Noch kein Spielplan. Trage zuerst die Spieler ein, dann wird er automatisch erstellt.</p>
          <button type="button" class="btn primary" data-tab="spieler">Spieler eintragen</button>
        </div>`;
    }
    const { players, schedule } = state.tournament;
    const { total, played } = matchTotals();
    const current = currentRound();
    const rounds = schedule.rounds
      .map((round, r) => {
        const done = roundDone(r);
        const pill = r === current
          ? '<span class="pill now">Jetzt</span>'
          : done ? '<span class="pill">Fertig</span>' : '';
        const byes = round.byes.length
          ? `<p class="byes">Pause: <b>${round.byes.map((p) => esc(players[p])).join(', ')}</b></p>`
          : '';
        return `
          <section class="round${r === current ? ' current' : ''}" id="round-${r}">
            <div class="round-head"><h2>Runde ${r + 1}</h2>${pill}</div>
            <div class="matches">${round.matches.map((match, m) => matchHtml(r, m, match)).join('')}</div>
            ${byes}
          </section>`;
      })
      .join('');
    return `
      ${title('Spielplan')}
      <div class="progress">
        ${played} von ${total} Spielen eingetragen
        <div class="bar"><span style="width:${total ? (played / total) * 100 : 0}%"></span></div>
      </div>
      ${rounds}`;
  }

  function sortMode() {
    if (state.sortBy) return state.sortBy;
    const { players, courts, schedule } = state.tournament;
    return isFair(players.length, courts, schedule.rounds.length) ? 'points' : 'avg';
  }

  const signed = (value) => (value > 0 ? `+${value}` : `${value}`);
  const signClass = (value) => (value > 0 ? 'pos' : value < 0 ? 'neg' : '');

  function winnerLine(rows) {
    const { total, played } = matchTotals();
    if (played < total) return '';
    const leaders = rows.filter((row) => row.rank === 1).map((row) => `<b>${esc(row.name)}</b>`);
    const verb = leaders.length > 1 ? 'gewinnen' : 'gewinnt';
    return `<p class="winner">Turnier beendet: ${leaders.join(' und ')} ${verb} mit ${rows[0].points} Punkten.</p>`;
  }

  function tableHtml() {
    if (!state.tournament) {
      return `
        ${title('Tabelle')}
        <div class="empty">
          <p>Die Tabelle füllt sich, sobald Resultate eingetragen sind.</p>
          <button type="button" class="btn primary" data-tab="spieler">Spieler eintragen</button>
        </div>`;
    }
    const { players, schedule, results } = state.tournament;
    const mode = sortMode();
    const rows = standings(players, schedule, results, mode);
    const lastHead = mode === 'avg' ? 'Ø' : 'Pkt';
    const body = rows
      .map((row) => `
        <tr class="${row.rank === 1 && row.games ? 'leader' : ''}">
          <td>${row.rank}</td>
          <td class="name">${esc(row.name)}</td>
          <td>${row.games}</td>
          <td>${row.wins}</td>
          <td>${row.draws}</td>
          <td>${row.losses}</td>
          <td class="${signClass(row.diff)}">${signed(row.diff)}</td>
          <td class="pts">${mode === 'avg' ? row.avg.toFixed(1) : row.points}</td>
        </tr>`)
      .join('');
    return `
      ${title('Tabelle')}
      ${winnerLine(rows)}
      <div class="chips" role="group" aria-label="Rangliste nach">
        <button type="button" class="chip" data-action="sort" data-value="points" aria-pressed="${mode === 'points'}">Punkte</button>
        <button type="button" class="chip" data-action="sort" data-value="avg" aria-pressed="${mode === 'avg'}">Ø pro Spiel</button>
      </div>
      <div class="table-card">
        <table>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col" class="name">Spieler</th>
              <th scope="col" title="Spiele">Sp</th>
              <th scope="col" title="Siege">S</th>
              <th scope="col" title="Unentschieden">U</th>
              <th scope="col" title="Niederlagen">N</th>
              <th scope="col" title="Punktedifferenz">+/−</th>
              <th scope="col">${lastHead}</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <p class="note">Sp Spiele · S Siege · U Unentschieden · N Niederlagen. Bei gleicher Wertung zählt zuerst die Differenz, dann die Siege. Ø ist fairer, solange noch nicht alle gleich viele Spiele haben.</p>`;
  }

  /* ---------- Darstellung ---------- */

  function render() {
    if (tab === 'spieler') {
      view.innerHTML = state.tournament ? tournamentPlayersHtml() : setupHtml();
      refreshSetupOptions();
    } else if (tab === 'spielplan') {
      view.innerHTML = scheduleHtml();
    } else {
      view.innerHTML = tableHtml();
    }
    document.querySelectorAll('.tabbar button').forEach((button) => {
      if (button.dataset.tab === tab) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  function setTab(next) {
    tab = next;
    try {
      history.replaceState(null, '', `#${next}`);
    } catch {
      /* In manchen eingebetteten Ansichten nicht erlaubt, die App läuft trotzdem. */
    }
    render();
    window.scrollTo(0, 0);
    if (next === 'spielplan' && state.tournament) scrollToCurrentRound();
  }

  function scrollToCurrentRound() {
    const current = currentRound();
    if (current > 0) document.getElementById(`round-${current}`).scrollIntoView();
  }

  /* ---------- Resultat eintragen ---------- */

  function openScore(r, m) {
    const saved = state.tournament.results[`${r}-${m}`];
    scoreDraft = { r, m, active: 'a', a: saved ? saved.a : null, saved: Boolean(saved) };
    renderScoreSheet();
    scoreSheet.showModal();
  }

  function renderScoreSheet() {
    const { players, points, schedule } = state.tournament;
    const { r, m, active, a, saved } = scoreDraft;
    const match = schedule.rounds[r].matches[m];
    const scoreOf = (side) => (a === null ? '–' : side === 'a' ? a : points - a);
    const teamButton = (side, team) => `
      <button type="button" class="sheet-team" data-action="team" data-value="${side}" aria-pressed="${active === side}">
        ${team.map((p) => `<span>${esc(players[p])}</span>`).join('')}
        <strong>${scoreOf(side)}</strong>
      </button>`;
    const selected = a === null ? null : active === 'a' ? a : points - a;
    const grid = Array.from({ length: points + 1 }, (_, value) =>
      `<button type="button" data-action="pick" data-value="${value}" aria-pressed="${value === selected}">${value}</button>`
    ).join('');
    const activeNames = (active === 'a' ? match.teamA : match.teamB).map((p) => players[p]).join(' & ');
    scoreSheet.innerHTML = `
      <h3 id="score-title">Runde ${r + 1} · Court ${match.court}</h3>
      <div class="sheet-teams">${teamButton('a', match.teamA)}${teamButton('b', match.teamB)}</div>
      <p class="sheet-hint">Punkte für ${esc(activeNames)}. Die andere Seite ergibt sich aus ${points} Punkten.</p>
      <div class="points-grid">${grid}</div>
      <div class="actions">
        <button type="button" class="btn primary" data-action="save-score" ${a === null ? 'disabled' : ''}>Speichern</button>
        ${saved ? '<button type="button" class="btn danger" data-action="clear-score">Resultat löschen</button>' : ''}
        <button type="button" class="btn" data-action="close-sheet">Abbrechen</button>
      </div>`;
  }

  function askConfirm(heading, text, label, onConfirm) {
    pendingConfirm = onConfirm;
    confirmSheet.innerHTML = `
      <h3 id="confirm-title">${esc(heading)}</h3>
      <p>${esc(text)}</p>
      <div class="actions">
        <button type="button" class="btn danger" data-action="confirm">${esc(label)}</button>
        <button type="button" class="btn" data-action="close-sheet">Abbrechen</button>
      </div>`;
    confirmSheet.showModal();
  }

  /* ---------- Aktionen ---------- */

  function newSeed() {
    return Math.floor(Math.random() * 4294967296);
  }

  function startTournament() {
    const config = draftConfig();
    if (!config.ready) return;
    state.tournament = {
      players: config.names,
      courts: config.courts,
      points: state.draft.points,
      schedule: generateSchedule(config.count, config.courts, config.rounds, newSeed()),
      results: {},
    };
    state.sortBy = null;
    save();
    setTab('spielplan');
  }

  function redraw() {
    const tournament = state.tournament;
    tournament.schedule = generateSchedule(
      tournament.players.length, tournament.courts, tournament.schedule.rounds.length, newSeed()
    );
    tournament.results = {};
    save();
    setTab('spielplan');
  }

  function backToSetup() {
    const { players, courts, points, schedule } = state.tournament;
    state.draft = { names: players.slice(), courts, points, rounds: schedule.rounds.length };
    state.tournament = null;
    state.sortBy = null;
    save();
    setTab('spieler');
  }

  const actions = {
    add() {
      state.draft.names.push('');
      save();
      render();
      document.getElementById(`player-${state.draft.names.length - 1}`).focus();
    },
    remove({ value }) {
      const { names } = state.draft;
      names.splice(Number(value), 1);
      while (names.length < MIN_PLAYERS) names.push('');
      state.draft.rounds = null;
      save();
      render();
    },
    example() {
      state.draft.names = EXAMPLE_NAMES.slice();
      state.draft.rounds = null;
      save();
      render();
    },
    courts({ value }) {
      state.draft.courts = Number(value);
      state.draft.rounds = null;
      save();
      refreshSetupOptions();
    },
    points({ value }) {
      state.draft.points = Number(value);
      save();
      refreshSetupOptions();
    },
    rounds({ value }) {
      const next = draftConfig().rounds + Number(value);
      state.draft.rounds = Math.min(MAX_ROUNDS, Math.max(1, next));
      save();
      refreshSetupOptions();
    },
    start: startTournament,
    redraw() {
      if (matchTotals().played === 0) {
        redraw();
        return;
      }
      askConfirm('Neu auslosen?', 'Alle eingetragenen Resultate werden gelöscht. Die Spieler bleiben gleich.', 'Neu auslosen', redraw);
    },
    new() {
      askConfirm('Neues Turnier starten?', 'Der Spielplan und alle Resultate werden gelöscht. Die Namen bleiben eingetragen.', 'Neues Turnier', backToSetup);
    },
    score({ r, m }) {
      openScore(Number(r), Number(m));
    },
    team({ value }) {
      scoreDraft.active = value;
      renderScoreSheet();
    },
    pick({ value }) {
      const picked = Number(value);
      scoreDraft.a = scoreDraft.active === 'a' ? picked : state.tournament.points - picked;
      renderScoreSheet();
      scoreSheet.querySelector(`[data-action="pick"][data-value="${value}"]`).focus();
    },
    'save-score'() {
      const { r, m, a } = scoreDraft;
      state.tournament.results[`${r}-${m}`] = { a, b: state.tournament.points - a };
      save();
      scoreSheet.close();
      render();
    },
    'clear-score'() {
      delete state.tournament.results[`${scoreDraft.r}-${scoreDraft.m}`];
      save();
      scoreSheet.close();
      render();
    },
    'close-sheet'({ element }) {
      element.closest('dialog').close();
    },
    confirm() {
      const run = pendingConfirm;
      pendingConfirm = null;
      confirmSheet.close();
      if (run) run();
    },
    sort({ value }) {
      state.sortBy = value;
      save();
      render();
    },
  };

  document.addEventListener('click', (event) => {
    /* Tippen neben ein Sheet schliesst es. */
    if (event.target === scoreSheet || event.target === confirmSheet) {
      event.target.close();
      return;
    }
    const tabButton = event.target.closest('[data-tab]');
    if (tabButton) {
      setTab(tabButton.dataset.tab);
      return;
    }
    const element = event.target.closest('[data-action]');
    if (!element || element.disabled) return;
    actions[element.dataset.action]({ ...element.dataset, element });
  });

  document.addEventListener('input', (event) => {
    const { name, rename } = event.target.dataset;
    if (name !== undefined) {
      const before = draftConfig().count;
      state.draft.names[Number(name)] = event.target.value;
      if (draftConfig().count !== before) state.draft.rounds = null;
      save();
      refreshSetupOptions();
    } else if (rename !== undefined && event.target.value.trim()) {
      state.tournament.players[Number(rename)] = event.target.value.trim();
      save();
    }
  });

  /* Leerer Name im laufenden Turnier: beim Verlassen den alten wieder anzeigen. */
  document.addEventListener('focusout', (event) => {
    const { rename } = event.target.dataset;
    if (rename !== undefined) event.target.value = state.tournament.players[Number(rename)];
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.target.dataset.name === undefined) return;
    event.preventDefault();
    const next = document.getElementById(`player-${Number(event.target.dataset.name) + 1}`);
    if (next) next.focus();
    else if (state.draft.names.length < MAX_PLAYERS) actions.add();
    else event.target.blur();
  });

  render();
  if (tab === 'spielplan' && state.tournament) scrollToCurrentRound();

  /* Ohne HTTPS gibt es keinen Offline-Modus, die App funktioniert trotzdem. */
  try {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  } catch {
    /* Service Worker in dieser Umgebung nicht verfügbar. */
  }
})();
