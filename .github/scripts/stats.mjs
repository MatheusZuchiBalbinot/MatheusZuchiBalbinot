// Renders the profile's stats card (contributions, longest streak, top languages) as one SVG,
// so both panels share a size, a palette and readable type.
const USER = process.env.GITHUB_USER;
const TOKEN = process.env.GITHUB_TOKEN;
const API = 'https://api.github.com';
const HIDDEN_LANGUAGES = new Set(['CSS', 'Blade', 'Shell']);
const TOP_LANGUAGES = 5;
const WIDTH = 840;
const HEIGHT = 180;
const GAP = 16;
const PANEL_WIDTH = (WIDTH - GAP) / 2;
const LANGUAGE_COLORS = { TypeScript: '#3178c6', JavaScript: '#f1e05a', PHP: '#777bb4', Go: '#00add8', Python: '#3572a5', C: '#555555', Dockerfile: '#384d54' };
const FALLBACK_COLOR = '#8b949e';
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const headers = { Authorization: `Bearer ${TOKEN}`, 'User-Agent': USER };

async function graphql(query, variables) {
  const response = await fetch(`${API}/graphql`, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
  const body = await response.json();

  if (!response.ok || body.errors) {
    throw new Error(`GraphQL failed: ${JSON.stringify(body.errors ?? body)}`);
  }

  return body.data;
}

async function rest(path) {
  const response = await fetch(`${API}${path}`, { headers });

  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status}`);
  }

  return response.json();
}

async function contributionDays() {
  const yearsQuery = 'query($login:String!){user(login:$login){contributionsCollection{contributionYears}}}';
  const { user } = await graphql(yearsQuery, { login: USER });
  const calendarQuery = 'query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}';
  const days = [];

  for (const year of user.contributionsCollection.contributionYears) {
    const variables = { login: USER, from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` };
    const data = await graphql(calendarQuery, variables);

    for (const week of data.user.contributionsCollection.contributionCalendar.weeks) {
      days.push(...week.contributionDays);
    }
  }

  return days.sort((left, right) => left.date.localeCompare(right.date));
}

function summarizeContributions(days) {
  const total = days.reduce((sum, day) => sum + day.contributionCount, 0);
  const firstActive = days.find((day) => day.contributionCount > 0);
  let best = { length: 0, start: null, end: null };
  let current = { length: 0, start: null, end: null };

  for (const day of days) {
    if (day.contributionCount === 0) {
      current = { length: 0, start: null, end: null };
      continue;
    }

    current = { length: current.length + 1, start: current.start ?? day.date, end: day.date };

    if (current.length > best.length) {
      best = current;
    }
  }

  return { total, since: firstActive?.date ?? null, best };
}

async function topLanguages() {
  const repos = await rest(`/users/${USER}/repos?type=owner&per_page=100`);
  const owned = repos.filter((repo) => !repo.fork);
  const bytes = new Map();

  for (const repo of owned) {
    const languages = await rest(`/repos/${USER}/${repo.name}/languages`);

    for (const [name, size] of Object.entries(languages)) {
      if (!HIDDEN_LANGUAGES.has(name)) {
        bytes.set(name, (bytes.get(name) ?? 0) + size);
      }
    }
  }

  const total = [...bytes.values()].reduce((sum, size) => sum + size, 0);

  return [...bytes.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, TOP_LANGUAGES)
    .map(([name, size]) => ({ name, share: size / total }));
}

function shortDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);

  return { day, month: MONTHS[month - 1], year };
}

function percent(share) {
  return `${(share * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function statBlock({ x, value, label, detail }) {
  return `<text x="${x}" y="92" class="value">${value}</text><text x="${x}" y="120" class="label">${label}</text><text x="${x}" y="144" class="detail">${detail}</text>`;
}

function contributionsPanel(summary) {
  const since = shortDate(summary.since);
  const start = shortDate(summary.best.start);
  const end = shortDate(summary.best.end);
  const left = statBlock({ x: PANEL_WIDTH * 0.27, value: summary.total.toLocaleString('pt-BR'), label: 'Contribuições', detail: `desde ${since.month}/${since.year}` });
  const right = statBlock({ x: PANEL_WIDTH * 0.73, value: `${summary.best.length} dias`, label: 'Maior sequência', detail: `${start.day} ${start.month} a ${end.day} ${end.month} de ${end.year}` });

  return `<g><rect width="${PANEL_WIDTH}" height="${HEIGHT}" rx="12" class="panel"/><text x="24" y="36" class="title">Atividade no GitHub</text>${left}<line x1="${PANEL_WIDTH / 2}" y1="62" x2="${PANEL_WIDTH / 2}" y2="150" class="divider"/>${right}</g>`;
}

function languagesPanel(languages) {
  const innerX = 24;
  const innerWidth = PANEL_WIDTH - innerX * 2;
  let offset = 0;
  const segments = languages.map((language) => {
    const width = language.share * innerWidth;
    const segment = `<rect x="${innerX + offset}" y="54" width="${width}" height="10" fill="${LANGUAGE_COLORS[language.name] ?? FALLBACK_COLOR}"/>`;

    offset += width;

    return segment;
  });
  const rows = languages.map((language, index) => {
    const column = index < 3 ? 0 : 1;
    const row = index < 3 ? index : index - 3;
    const x = innerX + column * (innerWidth / 2);
    const y = 98 + row * 28;
    const color = LANGUAGE_COLORS[language.name] ?? FALLBACK_COLOR;

    return `<circle cx="${x + 6}" cy="${y - 5}" r="6" fill="${color}"/><text x="${x + 20}" y="${y}" class="lang">${language.name}</text><text x="${x + innerWidth / 2 - 16}" y="${y}" class="share">${percent(language.share)}</text>`;
  });

  return `<g transform="translate(${PANEL_WIDTH + GAP} 0)"><rect width="${PANEL_WIDTH}" height="${HEIGHT}" rx="12" class="panel"/><text x="${innerX}" y="36" class="title">Linguagens mais usadas</text><clipPath id="bar"><rect x="${innerX}" y="54" width="${innerWidth}" height="10" rx="5"/></clipPath><g clip-path="url(#bar)">${segments.join('')}</g>${rows.join('')}</g>`;
}

function render(summary, languages) {
  const style = `
    .panel{fill:#1a1b27}
    .value{font:700 34px 'Segoe UI',Ubuntu,'Helvetica Neue',sans-serif;fill:#7aa2f7;text-anchor:middle}
    .label{font:600 15px 'Segoe UI',Ubuntu,'Helvetica Neue',sans-serif;fill:#c0caf5;text-anchor:middle}
    .detail{font:400 13px 'Segoe UI',Ubuntu,'Helvetica Neue',sans-serif;fill:#38bdae;text-anchor:middle}
    .title{font:700 18px 'Segoe UI',Ubuntu,'Helvetica Neue',sans-serif;fill:#7aa2f7}
    .lang{font:600 15px 'Segoe UI',Ubuntu,'Helvetica Neue',sans-serif;fill:#c0caf5}
    .share{font:400 14px 'Segoe UI',Ubuntu,'Helvetica Neue',sans-serif;fill:#a9b1d6;text-anchor:end}
    .divider{stroke:#3b4261;stroke-width:1.5}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Contribuições e linguagens de ${USER}"><style>${style}</style>${contributionsPanel(summary)}${languagesPanel(languages)}</svg>\n`;
}

const days = await contributionDays();
const summary = summarizeContributions(days);
const languages = await topLanguages();

process.stdout.write(render(summary, languages));
