(function () {
  const { maxCourts, isFair, gamesPerPlayer, recommendedRounds, generateSchedule, standings } = window.Americano;
  const { buildTeams, buildBracket, decideMatch, resolveBracket, pruneResults, placements } = window.AmericanoFinals;

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
  let setsDraft = null;
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

  function groupFinished() {
    const { total, played } = matchTotals();
    return total > 0 && played === total;
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
      ${rounds}
      ${finalsHtml()}`;
  }

  /* ---------- Finalrunde ---------- */

  const FORMAT_LABELS = {
    3: 'Halbfinale',
    4: 'Halbfinale',
    5: 'Viertelfinale und Halbfinale',
    6: 'Viertelfinale, Halbfinale und Spiel um Platz 5',
  };

  const BYE_NOTES = {
    3: 'Team 1 steht direkt im Finale.',
    5: 'Die Teams 1, 2 und 3 steigen im Halbfinale ein.',
    6: 'Die Teams 1 und 2 steigen im Halbfinale ein.',
  };

  function finalsHtml() {
    if (!groupFinished()) return '';
    return state.tournament.playoff ? finalsBracketHtml() : finalsOfferHtml();
  }

  function finalsOfferHtml() {
    const { players, schedule, results } = state.tournament;
    const rows = standings(players, schedule, results, sortMode());
    const { teams, leftover } = buildTeams(rows.map((row) => row.index));
    const bestOf = state.finalsBestOf || 1;
    const teamRows = teams
      .map((team, i) => `<li><span class="seed">Team ${i + 1}</span><span>${esc(team.map((p) => players[p]).join(' & '))}</span></li>`)
      .join('');
    const tied = rows.some((row, i) => i > 0 && rows[i - 1].rank === row.rank);
    const notes = [
      leftover !== null ? `${esc(players[leftover])} hat kein Team und belegt Platz ${teams.length + 1}.` : '',
      BYE_NOTES[teams.length] || '',
      tied ? 'Bei völligem Gleichstand entscheidet das Alphabet über die Teams.' : '',
    ].filter(Boolean);
    const format = teams.length > 2
      ? `
        <h2>${FORMAT_LABELS[teams.length]}</h2>
        <div class="chips">
          <button type="button" class="chip" data-action="finals-format" data-value="1" aria-pressed="${bestOf === 1}">1 Satz</button>
          <button type="button" class="chip" data-action="finals-format" data-value="3" aria-pressed="${bestOf === 3}">2 Gewinnsätze</button>
        </div>`
      : '';
    return `
      <section id="finals" class="finals">
        <h2 class="section-title">Plätze ausspielen<i>.</i></h2>
        <p class="lead">Alle Runden sind gespielt. Aus der Rangliste entstehen feste Teams, die alle Plätze ausspielen.</p>
        <ol class="seeds">${teamRows}</ol>
        ${notes.map((note) => `<p class="note">${note}</p>`).join('')}
        ${format}
        <p class="note">${teams.length >= 4 ? 'Spiel um Platz 3 und Finale gehen' : 'Das Finale geht'} immer über 2 Gewinnsätze.</p>
        <div class="actions">
          <button type="button" class="btn primary" data-action="finals-start">Finalrunde starten</button>
        </div>
      </section>`;
  }

  function currentBracket() {
    const { playoff } = state.tournament;
    return buildBracket(playoff.teams.length, playoff.bestOf);
  }

  const seedNames = (seed) =>
    state.tournament.playoff.teams[seed - 1].map((p) => state.tournament.players[p]);

  function sourceLabel(source, bracket) {
    const earlier = bracket.find((match) => match.id === (source.winner || source.loser));
    return `${source.winner ? 'Sieger' : 'Verlierer'} ${earlier.label}`;
  }

  function finalsTeamHtml(seed, source, side, lost, bracket) {
    if (!seed) return `<span class="team team-${side} open"><span>${esc(sourceLabel(source, bracket))}</span></span>`;
    return `<span class="team team-${side}${lost ? ' lost' : ''}">${seedNames(seed).map((name) => `<span>${esc(name)}</span>`).join('')}</span>`;
  }

  function finalsMatchHtml(row, bracket) {
    const ready = row.teamA && row.teamB;
    const heading = [
      row.label === row.stage ? '' : row.label,
      ready ? `Team ${row.teamA} gegen Team ${row.teamB}` : '',
    ].filter(Boolean).join(' · ');
    let score = ready ? '<span class="score-empty">Eintragen</span>' : '<span class="score-wait">offen</span>';
    let setLine = '';
    if (row.result) {
      const shown = row.bestOf === 1 ? row.result.sets[0] : row.wins;
      score = `<span class="score">${shown[0]}<i>:</i>${shown[1]}</span>`;
      if (row.bestOf > 1) setLine = `<span class="set-line">${row.result.sets.map((set) => `${set[0]}:${set[1]}`).join(' · ')}</span>`;
    }
    return `
      <button type="button" class="match${row.result ? ' played' : ''}" data-action="finals-score" data-value="${row.id}" ${ready ? '' : 'disabled'}>
        ${heading ? `<span class="match-court">${esc(heading)}</span>` : ''}
        ${finalsTeamHtml(row.teamA, row.a, 'a', row.winner === 'b', bracket)}
        ${score}
        ${finalsTeamHtml(row.teamB, row.b, 'b', row.winner === 'a', bracket)}
        ${setLine}
      </button>`;
  }

  function finalsBracketHtml() {
    const bracket = currentBracket();
    const rows = resolveBracket(bracket, state.tournament.playoff.results);
    const firstOpen = rows.find((row) => !row.winner);
    const stages = [...new Set(rows.map((row) => row.stage))];
    const sections = stages
      .map((stage) => {
        const matches = rows.filter((row) => row.stage === stage);
        const done = matches.every((row) => row.winner);
        const current = firstOpen && firstOpen.stage === stage;
        const pill = current
          ? '<span class="pill now">Jetzt</span>'
          : done ? '<span class="pill">Fertig</span>' : '';
        return `
          <section class="round${current ? ' current' : ''}">
            <div class="round-head">
              <h2>${esc(stage)}</h2>${pill}
              <span class="stage-format">${matches[0].bestOf === 1 ? '1 Satz' : '2 Gewinnsätze'}</span>
            </div>
            <div class="matches">${matches.map((row) => finalsMatchHtml(row, bracket)).join('')}</div>
          </section>`;
      })
      .join('');
    return `
      <section id="finals" class="finals">
        <h2 class="section-title">Finalrunde<i>.</i></h2>
        ${sections}
        <div class="actions">
          <button type="button" class="btn danger" data-action="finals-reset">Finalrunde zurücksetzen</button>
        </div>
      </section>`;
  }

  function finalStandingHtml() {
    const { playoff, players } = state.tournament;
    if (!playoff) return '';
    const bracket = currentBracket();
    const rows = placements(bracket, playoff.results).map(({ place, seed }) => ({
      place, name: seedNames(seed).join(' & '),
    }));
    if (playoff.leftover !== null) {
      rows.push({ place: playoff.teams.length + 1, name: players[playoff.leftover], note: 'ohne Team' });
    }
    const finished = resolveBracket(bracket, playoff.results).every((row) => row.winner);
    const champion = finished
      ? `<p class="winner">Turnier beendet: <b>${esc(rows[0].name)}</b> gewinnen die Finalrunde.</p>`
      : '<p class="note">Die Finalrunde läuft. Weitere Plätze erscheinen hier, sobald sie feststehen.</p>';
    const list = rows
      .map((row) => `
        <li><span class="seed">${row.place}.</span><span>${esc(row.name)}${row.note ? ` <em>${row.note}</em>` : ''}</span></li>`)
      .join('');
    return `
      ${champion}
      ${rows.length ? `<h2>Endstand</h2><ol class="seeds">${list}</ol>` : ''}
      <h2>Hauptrunde</h2>`;
  }

  function sortMode() {
    if (state.sortBy) return state.sortBy;
    const { players, courts, schedule } = state.tournament;
    return isFair(players.length, courts, schedule.rounds.length) ? 'points' : 'avg';
  }

  const signed = (value) => (value > 0 ? `+${value}` : `${value}`);
  const signClass = (value) => (value > 0 ? 'pos' : value < 0 ? 'neg' : '');

  function winnerLine(rows) {
    if (!groupFinished() || state.tournament.playoff) return '';
    const leaders = rows.filter((row) => row.rank === 1).map((row) => `<b>${esc(row.name)}</b>`);
    const verb = leaders.length > 1 ? 'gewinnen' : 'gewinnt';
    return `
      <p class="winner">Alle Runden gespielt: ${leaders.join(' und ')} ${verb} mit ${rows[0].points} Punkten.</p>
      <div class="actions winner-action"><button type="button" class="btn" data-tab="spielplan">Plätze ausspielen</button></div>`;
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
      ${finalStandingHtml()}
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
    const target = document.getElementById(current < 0 ? 'finals' : `round-${current}`);
    if (target && current !== 0) target.scrollIntoView();
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

  /* ---------- Sätze eintragen ---------- */

  function openSets(id) {
    const match = currentBracket().find((entry) => entry.id === id);
    const saved = state.tournament.playoff.results[id];
    const sets = Array.from({ length: match.bestOf }, (_, i) => {
      const set = saved && saved.sets[i];
      return set ? set.slice() : [null, null];
    });
    setsDraft = { id, sets, set: 0, side: 0, saved: Boolean(saved) };
    renderSetsSheet();
    scoreSheet.showModal();
  }

  /* Satz 3 gibt es erst bei 1:1, Satz 2 erst nach Satz 1. */
  function setReachable(bestOf, sets, index) {
    if (index === 0) return true;
    const before = decideMatch(bestOf, sets.slice(0, index));
    return !before.winner && !before.tied && before.sets.length === index;
  }

  function renderSetsSheet() {
    const { id, sets, set, side, saved } = setsDraft;
    const bracket = currentBracket();
    const row = resolveBracket(bracket, state.tournament.playoff.results).find((entry) => entry.id === id);
    const decision = decideMatch(row.bestOf, sets);
    const cell = (setIndex, sideIndex) => {
      const reachable = setReachable(row.bestOf, sets, setIndex);
      const value = sets[setIndex][sideIndex];
      const active = set === setIndex && side === sideIndex;
      return `<button type="button" class="set-cell${active ? ' active' : ''}" data-action="set-cell" data-set="${setIndex}" data-side="${sideIndex}"
        aria-label="Satz ${setIndex + 1}, Spiele ${sideIndex === 0 ? 'oben' : 'unten'}" ${reachable ? '' : 'disabled'}>${reachable && value !== null ? value : '–'}</button>`;
    };
    const line = (seed, sideIndex) => `
      <span class="set-team">${seedNames(seed).map((name) => `<span>${esc(name)}</span>`).join('')}</span>
      ${sets.map((_, setIndex) => cell(setIndex, sideIndex)).join('')}`;
    const headers = sets.map((_, i) => `<span class="set-head">Satz ${i + 1}</span>`).join('');
    const grid = Array.from({ length: 8 }, (_, value) =>
      `<button type="button" data-action="set-pick" data-value="${value}" aria-pressed="${sets[set][side] === value}">${value}</button>`
    ).join('');
    let status = 'Tippe auf ein Feld und wähle die gewonnenen Spiele.';
    if (decision.tied) status = 'Ein Satz kann nicht unentschieden enden.';
    else if (decision.winner) {
      const seed = decision.winner === 'a' ? row.teamA : row.teamB;
      status = `Sieger: ${seedNames(seed).join(' & ')}`;
    }
    scoreSheet.innerHTML = `
      <h3 id="score-title">${esc(row.label)}</h3>
      <div class="set-board" style="grid-template-columns:minmax(0,1fr) repeat(${sets.length},48px)">
        <span></span>${headers}
        ${line(row.teamA, 0)}
        ${line(row.teamB, 1)}
      </div>
      <p class="sheet-hint${decision.tied ? ' warn' : ''}">${esc(status)}</p>
      <div class="points-grid sets-grid">${grid}</div>
      <div class="actions">
        <button type="button" class="btn primary" data-action="save-sets" ${decision.winner ? '' : 'disabled'}>Speichern</button>
        ${saved ? '<button type="button" class="btn danger" data-action="clear-sets">Resultat löschen</button>' : ''}
        <button type="button" class="btn" data-action="close-sheet">Abbrechen</button>
      </div>`;
  }

  /* Ändert ein Resultat. Spiele, deren Teams dadurch wechseln, werden nach Rückfrage gelöscht. */
  function applyFinalsResults(next) {
    const pruned = pruneResults(currentBracket(), next);
    const apply = () => {
      state.tournament.playoff.results = pruned.results;
      save();
      render();
    };
    scoreSheet.close();
    if (pruned.removed.length === 0) {
      apply();
      return;
    }
    askConfirm(
      'Folgespiele löschen?',
      `Durch die Änderung spielen andere Teams weiter. ${plural(pruned.removed.length, 'bereits eingetragenes Folgespiel wird', 'bereits eingetragene Folgespiele werden')} gelöscht.`,
      'Ändern und löschen',
      apply
    );
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
    tournament.playoff = null;
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
      if (!state.tournament.playoff) {
        openScore(Number(r), Number(m));
        return;
      }
      askConfirm(
        'Finalrunde zurücksetzen?',
        'Die Teams der Finalrunde stammen aus diesen Resultaten. Um ein Resultat zu ändern, wird die Finalrunde gelöscht.',
        'Zurücksetzen und ändern',
        () => {
          state.tournament.playoff = null;
          save();
          render();
          openScore(Number(r), Number(m));
        }
      );
    },
    'finals-format'({ value }) {
      state.finalsBestOf = Number(value);
      save();
      render();
    },
    'finals-start'() {
      const { players, schedule, results } = state.tournament;
      const rows = standings(players, schedule, results, sortMode());
      const { teams, leftover } = buildTeams(rows.map((row) => row.index));
      state.tournament.playoff = { teams, leftover, bestOf: state.finalsBestOf || 1, results: {} };
      save();
      render();
      document.getElementById('finals').scrollIntoView();
    },
    'finals-reset'() {
      askConfirm('Finalrunde zurücksetzen?', 'Teams und Resultate der Finalrunde werden gelöscht. Die Hauptrunde bleibt erhalten.', 'Zurücksetzen', () => {
        state.tournament.playoff = null;
        save();
        render();
      });
    },
    'finals-score'({ value }) {
      openSets(value);
    },
    'set-cell'({ set, side }) {
      setsDraft.set = Number(set);
      setsDraft.side = Number(side);
      renderSetsSheet();
    },
    'set-pick'({ value }) {
      const { id, sets, set, side } = setsDraft;
      sets[set][side] = Number(value);
      const { bestOf } = currentBracket().find((entry) => entry.id === id);
      /* Weiter zum nächsten Feld, damit ein Satz mit zwei Tipps erfasst ist. */
      if (side === 0) setsDraft.side = 1;
      else if (set + 1 < sets.length && setReachable(bestOf, sets, set + 1)) {
        setsDraft.set = set + 1;
        setsDraft.side = 0;
      }
      renderSetsSheet();
    },
    'save-sets'() {
      const { id, sets } = setsDraft;
      const bracket = currentBracket();
      const { playoff } = state.tournament;
      const row = resolveBracket(bracket, playoff.results).find((entry) => entry.id === id);
      const decision = decideMatch(row.bestOf, sets);
      applyFinalsResults({ ...playoff.results, [id]: { teams: [row.teamA, row.teamB], sets: decision.sets } });
    },
    'clear-sets'() {
      const next = { ...state.tournament.playoff.results };
      delete next[setsDraft.id];
      applyFinalsResults(next);
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
      const wasFinished = groupFinished();
      state.tournament.results[`${r}-${m}`] = { a, b: state.tournament.points - a };
      save();
      scoreSheet.close();
      render();
      if (!wasFinished && groupFinished()) document.getElementById('finals').scrollIntoView();
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
