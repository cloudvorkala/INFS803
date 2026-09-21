/* ---------------------------------------------------------------------------
   Catalogue generator — the single source of truth for seed data.

   Writes:
     src/data/books.json        100 books, used by the mock API and the UI
     public/covers/bk-NNN.svg   one cover image per book
     tools/seed-data/*.json     import-ready files for the backend teammate

   Run:  node tools/build-catalogue.mjs

   Covers are generated rather than sourced so every book has a real image file
   that ships to S3 with the site — no placeholder gaps in the grid, and no
   licensing questions. They are designed to be replaced: once someone uploads a
   real cover through /admin, the API returns that S3 URL instead.
   --------------------------------------------------------------------------- */

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/* --- The catalogue ---------------------------------------------------------
   [title, author, category, year, price, stock, description]
   Authors recur across titles, which is what makes a catalogue feel like a real
   shop rather than a random list.
   -------------------------------------------------------------------------- */

const BOOKS = [
  // ---- Fiction ----
  ['The Salt Path Home', 'Marguerite Ellery', 'Fiction', 2021, 24.99, 12, 'A family returns to the coastal town they swore they had left for good; Ellery writes tides the way others write memory.'],
  ['The Cartographer’s Daughter', 'Marguerite Ellery', 'Fiction', 2018, 22.99, 18, 'A girl inherits her father’s unfinished atlas and spends a decade deciding whether to complete it.'],
  ['Weatherhouse', 'Marguerite Ellery', 'Fiction', 2024, 27.50, 9, 'Three generations of women keep a lighthouse that has not been lit in forty years.'],
  ['A Grammar of Silence', 'Yusuf Karim', 'Fiction', 2022, 27.50, 0, 'A translator loses the ability to speak and begins a notebook of everything she cannot say.'],
  ['The Quiet Instrument', 'Hélène Marceau', 'Fiction', 2024, 26.00, 6, 'A luthier takes a final commission from a client who will not explain what the instrument is for.'],
  ['Bright Interval', 'Hélène Marceau', 'Fiction', 2019, 23.50, 14, 'Two strangers share a train compartment across a country neither of them can name.'],
  ['The Wintering', 'Ada Fenwick', 'Fiction', 2023, 25.00, 11, 'A novel about the year a village agreed, without discussing it, to stop speaking to one another.'],
  ['Small Mercies of the Tide', 'Ada Fenwick', 'Fiction', 2020, 21.99, 16, 'Fenwick’s breakthrough: a fishing town, a drowned boy, and forty years of careful silence.'],
  ['The Lantern Keeper', 'Josiah Bell', 'Fiction', 2017, 19.99, 21, 'A man walks the same six miles of coast every night for thirty years, and one night finds company.'],
  ['Nine Kinds of Leaving', 'Josiah Bell', 'Fiction', 2022, 24.50, 8, 'Nine linked stories, each one a departure, each one from a different side of the door.'],
  ['The Orchard at Dusk', 'Priya Anand', 'Fiction', 2025, 28.00, 13, 'An inheritance dispute over an orchard becomes an argument about what a family owes its dead.'],
  ['Paper Cities', 'Priya Anand', 'Fiction', 2021, 25.50, 7, 'An architect designs buildings that are never built and begins to prefer them that way.'],
  ['The Long Sunday', 'Tomas Bergqvist', 'Fiction', 2016, 18.99, 24, 'One day in a small Swedish town, told sixteen times from sixteen windows.'],
  ['Harbour Light', 'Nuala Devine', 'Fiction', 2023, 24.00, 15, 'A harbourmaster’s logbook becomes an accidental record of a town’s slow disappearance.'],
  ['The Understudy', 'Nuala Devine', 'Fiction', 2019, 21.50, 19, 'She has played the second part for twenty years, and tonight the lead does not arrive.'],

  // ---- Mystery ----
  ['Cold Reading', 'Ilse Brandt', 'Mystery', 2024, 21.50, 11, 'A stage mentalist helps with a missing-persons case and finds her tricks work uncomfortably well.'],
  ['Ledger', 'Ilse Brandt', 'Mystery', 2025, 23.00, 3, 'A forensic accountant and a former mentalist work the same case from opposite ends.'],
  ['The Second Witness', 'Ilse Brandt', 'Mystery', 2022, 20.99, 17, 'Everyone agrees what happened. The one person who disagrees was not there.'],
  ['The Nightjar Papers', 'Yusuf Karim', 'Mystery', 2020, 24.00, 15, 'A literary estate, a disputed manuscript, and an archivist who is not who she says she is.'],
  ['A Thin Alibi', 'Gordon Achebe', 'Mystery', 2023, 22.50, 10, 'The suspect has an alibi for the murder but not for the eleven minutes before it.'],
  ['The Roscoe Street Fire', 'Gordon Achebe', 'Mystery', 2021, 21.00, 13, 'Six flats, one fire, and an insurance investigator who cannot make the timeline close.'],
  ['Dead Reckoning', 'Marta Silvestri', 'Mystery', 2024, 23.50, 9, 'A yacht arrives in port with full sails, a set table, and nobody aboard.'],
  ['The Glasshouse Murders', 'Marta Silvestri', 'Mystery', 2019, 19.99, 22, 'A botanical garden, a locked conservatory, and a detective allergic to almost everything in it.'],
  ['What the Porter Saw', 'Edwin Croft', 'Mystery', 2018, 18.50, 26, 'A college porter has watched forty years of comings and goings, and remembers all of them.'],
  ['The Quiet Part', 'Edwin Croft', 'Mystery', 2025, 25.00, 5, 'A podcast reopens a cold case, and the host starts receiving episodes she did not record.'],
  ['Ninety Seconds', 'Rania Haddad', 'Mystery', 2023, 22.00, 14, 'The gap in the CCTV is ninety seconds long. Everything happened inside it.'],
  ['The Tenant Below', 'Rania Haddad', 'Mystery', 2021, 20.50, 18, 'She hears her own conversations repeated through the floor, a day late.'],

  // ---- Poetry ----
  ['Small Hours', 'Anneke Vos', 'Poetry', 2023, 18.00, 20, 'Sixty short poems written between two and four in the morning across a single winter.'],
  ['Nine Bridges', 'Anneke Vos', 'Poetry', 2020, 19.50, 13, 'Each poem named for a crossing in the city where Vos grew up.'],
  ['The Salt Book', 'Anneke Vos', 'Poetry', 2025, 21.00, 8, 'Poems about preservation: of fish, of grief, of a language with four remaining speakers.'],
  ['Field Notes for the Sleepless', 'Cormac Rea', 'Poetry', 2022, 17.50, 16, 'Short, plain, and unsparing. Rea writes insomnia as a kind of attention.'],
  ['Bell, Book, Weather', 'Cormac Rea', 'Poetry', 2019, 16.99, 23, 'Three sequences on ritual, reading, and the sky over the Atlantic.'],
  ['Instructions for a Garden', 'Beatriz Oliveira', 'Poetry', 2024, 20.00, 11, 'Every poem is phrased as a horticultural instruction. None of them is about gardening.'],
  ['The Blue Hour Almanac', 'Beatriz Oliveira', 'Poetry', 2021, 18.50, 15, 'A year of dusks, one poem each, from a window that never changes.'],
  ['Cargo', 'Tunde Falade', 'Poetry', 2023, 19.00, 12, 'Poems about what ships carry and what they leave behind on both shores.'],
  ['The Weight Room', 'Tunde Falade', 'Poetry', 2025, 20.50, 7, 'Falade turns the vocabulary of strength training into a language for grief.'],
  ['Hymnal for Empty Rooms', 'Saoirse Whelan', 'Poetry', 2020, 17.00, 19, 'Sparse, liturgical poems written after the closing of a rural parish.'],

  // ---- History ----
  ['The Weight of Maps', 'Tomas Bergqvist', 'History', 2020, 39.95, 5, 'How cartographers shaped empires by choosing what to leave out. A history of omission in eleven maps.'],
  ['The Merchant’s Clock', 'Tomas Bergqvist', 'History', 2023, 42.00, 8, 'Standard time was not discovered; it was sold. A history of who benefited from the hour.'],
  ['The Long Field', 'Ruth Ó Cadhla', 'History', 2021, 32.00, 8, 'Four hundred years of a single Irish field, told through the people who worked it.'],
  ['Common Ground', 'Ruth Ó Cadhla', 'History', 2024, 36.50, 6, 'Enclosure, commons, and the long argument about who is allowed to stand where.'],
  ['Saltpetre', 'Hugh Marchetti', 'History', 2019, 38.00, 11, 'A global history of gunpowder’s least glamorous ingredient and the empires built on it.'],
  ['The Coffee Ledger', 'Hugh Marchetti', 'History', 2022, 34.95, 14, 'Trade, credit, and caffeine: how one commodity rewired European finance.'],
  ['Cities Under Cities', 'Anais Perrot', 'History', 2025, 45.00, 4, 'What lies beneath eight cities, and what each chose to build over.'],
  ['The Cartulary', 'Anais Perrot', 'History', 2018, 41.50, 7, 'A single monastery’s property records, read as a thousand-year social history.'],
  ['Plague Roads', 'Sunil Mehta', 'History', 2020, 37.00, 12, 'The routes disease travelled were the routes trade had already built.'],
  ['The Signal Corps', 'Sunil Mehta', 'History', 2023, 39.50, 9, 'Semaphore, telegraph, radio: how command outran the speed of a horse.'],
  ['Empire of Wool', 'Greta Lindqvist', 'History', 2017, 33.00, 16, 'Sheep, cloth, and the making of the North Atlantic economy.'],
  ['The Last Ferry', 'Greta Lindqvist', 'History', 2024, 35.50, 10, 'Island communities and the infrastructure decisions that quietly ended them.'],

  // ---- Science ----
  ['Understorey', 'Fern Whitlock', 'Science', 2023, 34.95, 14, 'Six years beneath a temperate rainforest canopy, and what the soil knows that we do not.'],
  ['Root and Branch', 'Fern Whitlock', 'Science', 2019, 31.50, 10, 'Mycorrhizal networks, written before the topic was fashionable and rather more careful for it.'],
  ['Sleep, Interrupted', 'Dr. Naomi Sung', 'Science', 2022, 29.99, 22, 'What sleep research shows, and where popular advice has run well ahead of the evidence.'],
  ['The Attention Economy of the Brain', 'Dr. Naomi Sung', 'Science', 2025, 33.50, 9, 'Sung on what neuroscience can and cannot say about distraction.'],
  ['Deep Time, Shallow Water', 'Ezra Kohn', 'Science', 2021, 36.00, 13, 'Reading four billion years out of a single tidal flat.'],
  ['The Isotope Diaries', 'Ezra Kohn', 'Science', 2024, 38.50, 7, 'How trace atoms date bones, catch forgers, and settle arguments.'],
  ['Swarm', 'Ingrid Halvorsen', 'Science', 2020, 30.00, 18, 'Collective behaviour from starlings to traffic, and why the maths keeps rhyming.'],
  ['The Cold Chain', 'Ingrid Halvorsen', 'Science', 2023, 32.50, 11, 'Refrigeration as the invisible infrastructure holding modern medicine together.'],
  ['Antifragile Bones', 'Marcus Oyelaran', 'Science', 2022, 31.00, 15, 'Why bone is a living material, and what engineers keep learning from it.'],
  ['The Silent Spectrum', 'Marcus Oyelaran', 'Science', 2025, 35.00, 6, 'Everything the eye cannot see, and the instruments built to see it anyway.'],
  ['Weather Machines', 'Clara Dubois', 'Science', 2019, 28.50, 20, 'Forecasting from folklore to supercomputing, and the limits that will not move.'],
  ['The Origin of Salt', 'Clara Dubois', 'Science', 2024, 33.00, 12, 'Oceans, cells, and the chemistry that made both possible.'],

  // ---- Technology ----
  ['Concurrency in Practice', 'Devan Roy', 'Technology', 2019, 68.50, 7, 'Threads, locks, and the failure modes that only appear under load. Heavy on worked examples.'],
  ['What the Machine Wants', 'Devan Roy', 'Technology', 2025, 45.00, 16, 'Essays on designing software honest about its own limits. Roy’s most argumentative book.'],
  ['The Debugging Mind', 'Devan Roy', 'Technology', 2022, 52.00, 10, 'Not tools but method: how good engineers form and kill hypotheses.'],
  ['Distributed Systems for the Impatient', 'Priya Raghavan', 'Technology', 2024, 74.00, 9, 'Consensus, replication, and partition tolerance without the proofs.'],
  ['Cloud Native Patterns in Anger', 'Priya Raghavan', 'Technology', 2026, 79.95, 4, 'What breaks when the reference architecture meets a real budget and a real deadline.'],
  ['The Cost of Abstraction', 'Priya Raghavan', 'Technology', 2021, 66.00, 12, 'Every layer you add buys something and charges for it. Raghavan itemises the bill.'],
  ['Designing Data Boundaries', 'Kenji Watanabe', 'Technology', 2023, 71.50, 8, 'Where to draw the lines between services, and how to move them later.'],
  ['Observability Without Tears', 'Kenji Watanabe', 'Technology', 2025, 69.00, 11, 'Logs, metrics, traces: what to collect and, more usefully, what to ignore.'],
  ['The Small Web', 'Marisol Vega', 'Technology', 2024, 42.00, 17, 'A case for software built by two people for two hundred, not by two hundred for two million.'],
  ['Interface Debt', 'Marisol Vega', 'Technology', 2021, 48.50, 13, 'The compounding cost of every UI decision nobody wanted to revisit.'],
  ['Type Systems for Working Programmers', 'Anders Krogh', 'Technology', 2020, 76.00, 6, 'Practical type theory for people shipping code, not writing papers about it.'],
  ['The Migration', 'Anders Krogh', 'Technology', 2023, 58.00, 9, 'Six real platform migrations, including the two that failed and why.'],
  ['Rate Limits', 'Ola Adeyemi', 'Technology', 2025, 54.50, 14, 'Backpressure, queues, and the arithmetic of saying no gracefully.'],
  ['Schema Evolution', 'Ola Adeyemi', 'Technology', 2022, 62.00, 10, 'How to change the shape of data that thousands of clients already depend on.'],

  // ---- Biography ----
  ['The Instrument Maker', 'Lucia Ferrante', 'Biography', 2022, 36.00, 12, 'A life of the woman who built the telescopes three Nobel laureates used.'],
  ['Second Chair', 'Lucia Ferrante', 'Biography', 2025, 38.50, 8, 'The orchestral musicians nobody names, and the careers they built anyway.'],
  ['A Life in Margins', 'Oskar Lindeman', 'Biography', 2020, 34.50, 15, 'The editor who shaped a century of fiction and published nothing under his own name.'],
  ['The Reluctant Cartographer', 'Oskar Lindeman', 'Biography', 2023, 37.00, 9, 'A surveyor who mapped a border he spent the rest of his life arguing against.'],
  ['Hands', 'Amara Nkemdirim', 'Biography', 2024, 33.00, 13, 'Six lives told entirely through what their hands did for a living.'],
  ['The Understudied Life', 'Amara Nkemdirim', 'Biography', 2021, 31.50, 17, 'A biography of a woman who appears in three footnotes and no index.'],
  ['Correspondence', 'Ivan Petrov', 'Biography', 2019, 39.00, 11, 'Two scientists, forty years of letters, and one argument they never resolved.'],
  ['The Long Apprenticeship', 'Ivan Petrov', 'Biography', 2025, 41.00, 6, 'Mastery, told through eleven people who took decades to get good.'],
  ['Stagehand', 'Bridget Ó Muirí', 'Biography', 2022, 30.00, 19, 'Fifty years backstage at one theatre, and everything that happened out of the light.'],
  ['The Keeper of Records', 'Bridget Ó Muirí', 'Biography', 2018, 28.50, 21, 'A parish registrar whose careful handwriting outlasted every institution she served.'],

  // ---- Art & Design ----
  ['The Grid and the Gutter', 'Johannes Weiss', 'Art & Design', 2021, 55.00, 10, 'Swiss typography’s long argument with itself, told through fifty spreads.'],
  ['Colour Before Chemistry', 'Johannes Weiss', 'Art & Design', 2024, 62.00, 7, 'Where pigment came from before it came from a factory.'],
  ['Bindings', 'Estelle Faure', 'Art & Design', 2023, 58.50, 9, 'Six centuries of bookbinding as structural engineering and as argument.'],
  ['The Marginal Hand', 'Estelle Faure', 'Art & Design', 2020, 49.00, 14, 'Doodles, corrections, and glosses: what readers did to the books they owned.'],
  ['Shop Fronts', 'Nadia Rahman', 'Art & Design', 2025, 47.50, 11, 'Vernacular signage from twelve cities, photographed before it disappears.'],
  ['The Chair Problem', 'Nadia Rahman', 'Art & Design', 2022, 52.50, 8, 'Why the most designed object in the world is still uncomfortable.'],
  ['Blueprint and Bodge', 'Rory Sandeman', 'Art & Design', 2019, 44.00, 16, 'The gap between what architects drew and what builders actually did.'],
  ['Ornament Returns', 'Rory Sandeman', 'Art & Design', 2026, 59.00, 5, 'A century after it was declared a crime, decoration is back. Sandeman asks what changed.'],
  ['The Reading Room', 'Wilhelmina Achterberg', 'Art & Design', 2023, 54.00, 12, 'Library architecture and the century-long question of how to house silence.'],
  ['Paper, Ink, Pressure', 'Wilhelmina Achterberg', 'Art & Design', 2021, 51.00, 13, 'Letterpress as a set of physical constraints that produced a visual language.'],
  ['Everything Is a Poster', 'Kofi Mensah', 'Art & Design', 2024, 46.50, 15, 'Protest, promotion, and propaganda in one hundred sheets of paper.'],
  ['The Second Draft', 'Kofi Mensah', 'Art & Design', 2020, 43.00, 18, 'Design process from twenty studios, showing the versions nobody publishes.'],
  ['The Frost Line', 'Ada Fenwick', 'Fiction', 2026, 26.50, 0, 'A border town where the boundary moves each winter, and the paperwork never keeps up.'],
  ['Tidal Mathematics', 'Ezra Kohn', 'Science', 2026, 37.50, 10, 'Predicting the sea: two thousand years of getting it almost right.'],
  ['Systems That Outlive You', 'Kenji Watanabe', 'Technology', 2026, 72.00, 7, 'Writing software on the assumption that someone else will maintain it for a decade.'],
];

/* --- Cover art -------------------------------------------------------------
   Bookbinding cloth colours with foil-stamped type. Eight layouts, chosen
   deterministically per book so a title always gets the same cover.
   -------------------------------------------------------------------------- */

const CLOTHS = [
  { bg: '#2F5D45', ink: '#F0E6D2', foil: '#C9A15A' }, // forest
  { bg: '#1F3A5F', ink: '#E8EDF4', foil: '#C9A15A' }, // navy
  { bg: '#6E2733', ink: '#F5E6E2', foil: '#D9AE7A' }, // oxblood
  { bg: '#7A5C1E', ink: '#FBF3DF', foil: '#F0DBA8' }, // mustard
  { bg: '#3A4750', ink: '#EDEFF1', foil: '#B9C4CC' }, // slate
  { bg: '#4A2E52', ink: '#F1E7F3', foil: '#C9A15A' }, // plum
  { bg: '#1D4E4B', ink: '#E3F0EE', foil: '#C9A15A' }, // teal
  { bg: '#2A2723', ink: '#EFE9DE', foil: '#C9A15A' }, // charcoal
  { bg: '#5A3A22', ink: '#F4E7D8', foil: '#DCB98A' }, // tan leather
  { bg: '#33502C', ink: '#E9F0E4', foil: '#CBB06A' }, // olive
];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Break a title into lines of at most `max` characters, on word boundaries. */
function wrap(text, max) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if ((line + ' ' + word).length <= max) line += ' ' + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function cover(book) {
  const h = hash(book.title);
  const c = CLOTHS[h % CLOTHS.length];
  const layout = Math.floor(h / 7) % 6;
  const W = 400;
  const H = 600;

  const surname = book.author.split(' ').slice(-1)[0].toUpperCase();
  const titleLines = wrap(book.title.toUpperCase(), 15).slice(0, 4);
  const size = titleLines.length > 3 ? 30 : titleLines.length > 2 ? 34 : 40;
  const serif = "Georgia,'Times New Roman',serif";
  const sans = "'Helvetica Neue',Arial,sans-serif";

  let art = '';
  let titleCentre = 0; // vertical centre of the title block

  if (layout === 0) {
    // Framed panel — classic cloth binding with a double foil rule
    art = `<rect x="26" y="26" width="${W - 52}" height="${H - 52}" fill="none" stroke="${c.foil}" stroke-width="1.5"/>
  <rect x="34" y="34" width="${W - 68}" height="${H - 68}" fill="none" stroke="${c.foil}" stroke-width="0.5" opacity="0.6"/>`;
    titleCentre = 265;
  } else if (layout === 1) {
    // Colour field above, tinted band below
    art = `<rect x="0" y="372" width="${W}" height="228" fill="${c.foil}" opacity="0.13"/>
  <line x1="0" y1="372" x2="${W}" y2="372" stroke="${c.foil}" stroke-width="2"/>`;
    titleCentre = 205;
  } else if (layout === 2) {
    // Foil disc above the title
    art = `<circle cx="${W / 2}" cy="190" r="86" fill="none" stroke="${c.foil}" stroke-width="1.5"/>
  <circle cx="${W / 2}" cy="190" r="73" fill="${c.foil}" opacity="0.10"/>`;
    titleCentre = 385;
  } else if (layout === 3) {
    // Rule stack — letterpress furniture
    art = Array.from({ length: 7 }, (_, i) =>
      `<line x1="46" y1="${92 + i * 13}" x2="${W - 46}" y2="${92 + i * 13}" stroke="${c.foil}" stroke-width="${i % 2 ? 0.6 : 2}" opacity="0.75"/>`
    ).join('\n  ');
    titleCentre = 320;
  } else if (layout === 4) {
    // Opposed corner rules — spare and modernist
    art = `<line x1="46" y1="86" x2="${W - 46}" y2="86" stroke="${c.foil}" stroke-width="2"/>
  <line x1="46" y1="86" x2="46" y2="172" stroke="${c.foil}" stroke-width="2"/>
  <line x1="${W - 46}" y1="${H - 110}" x2="46" y2="${H - 110}" stroke="${c.foil}" stroke-width="2"/>
  <line x1="${W - 46}" y1="${H - 110}" x2="${W - 46}" y2="${H - 196}" stroke="${c.foil}" stroke-width="2"/>`;
    titleCentre = 300;
  } else {
    // Stamped monogram
    const initial = book.title.replace(/^(The|A|An)\s+/i, '').charAt(0).toUpperCase();
    art = `<rect x="${W / 2 - 50}" y="112" width="100" height="100" fill="none" stroke="${c.foil}" stroke-width="1.5"/>
  <text x="${W / 2}" y="182" font-family="${serif}" font-size="58" fill="${c.foil}" text-anchor="middle">${esc(initial)}</text>`;
    titleCentre = 360;
  }

  // Centre the whole title block on titleCentre rather than hanging it off a baseline.
  const leading = size + 8;
  const firstBaseline = titleCentre - ((titleLines.length - 1) * leading) / 2 + size * 0.34;
  const titleTspans = titleLines
    .map(
      (l, i) =>
        `<tspan x="${W / 2}" y="${Math.round(firstBaseline + i * leading)}">${esc(l)}</tspan>`
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(book.title)} by ${esc(book.author)}">
  <rect width="${W}" height="${H}" fill="${c.bg}"/>
  <rect x="0" y="0" width="10" height="${H}" fill="#000" opacity="0.22"/>
  ${art}
  <text font-family="${serif}" font-size="${size}" fill="${c.ink}" text-anchor="middle" letter-spacing="1">${titleTspans}</text>
  <line x1="${W / 2 - 34}" y1="${H - 88}" x2="${W / 2 + 34}" y2="${H - 88}" stroke="${c.foil}" stroke-width="1"/>
  <text x="${W / 2}" y="${H - 60}" font-family="${sans}" font-size="15" fill="${c.foil}" text-anchor="middle" letter-spacing="3.5">${esc(surname)}</text>
</svg>`;
}

/* --- ISBN ----------------------------------------------------------------- */

function isbn13(seed) {
  // Deterministic, structurally valid ISBN-13 with a correct check digit.
  const body = ('978' + String(1000000000 + (seed % 899999999)).slice(0, 9)).slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(body[i]) * (i % 2 ? 3 : 1);
  const check = (10 - (sum % 10)) % 10;
  const d = body + check;
  return `${d.slice(0, 3)}-${d.slice(3, 4)}-${d.slice(4, 8)}-${d.slice(8, 12)}-${d.slice(12)}`;
}

/* --- Build ---------------------------------------------------------------- */

/* Where cover images are served from. Defaults to a site-relative path so the
   covers ship with the client build. Once they live in their own S3 bucket:

     COVER_BASE=https://<bucket>.s3.ap-southeast-2.amazonaws.com/covers node tools/build-catalogue.mjs

   which rewrites every coverUrl in the seed data. The client renders whatever
   string the API returns, so nothing in the frontend changes. */
const COVER_BASE = (process.env.COVER_BASE || '/covers').replace(/\/$/, '');

const books = BOOKS.map(([title, author, category, publishedYear, price, stock, description], i) => {
  const id = `bk-${String(i + 1).padStart(3, '0')}`;
  return {
    id,
    title,
    author,
    category,
    price,
    stock,
    isbn: isbn13(hash(title)),
    publishedYear,
    coverUrl: `${COVER_BASE}/${id}.svg`,
    description,
  };
});

const coversDir = join(root, 'public', 'covers');
rmSync(coversDir, { recursive: true, force: true });
mkdirSync(coversDir, { recursive: true });
books.forEach((b) => writeFileSync(join(coversDir, `${b.id}.svg`), cover(b)));

mkdirSync(join(root, 'src', 'data'), { recursive: true });
writeFileSync(join(root, 'src', 'data', 'books.json'), JSON.stringify(books, null, 2) + '\n');

/* Import-ready exports for the backend/database layer. */
const seedDir = join(root, 'tools', 'seed-data');
mkdirSync(seedDir, { recursive: true });

/* The database copies carry one extra attribute the client does not need:
   `searchText`, a pre-lowercased "title author isbn" blob.

   DynamoDB's `contains()` is case-sensitive and cannot index substrings, so
   GET /products?search= would otherwise have to pull every item back and filter
   in the application. One denormalised lowercase field lets the filter run
   inside DynamoDB instead, which is the difference between shipping 100 items
   over the wire per keystroke and shipping only the matches. */
const dbBooks = books.map((b) => ({
  ...b,
  searchText: `${b.title} ${b.author} ${b.isbn}`.toLowerCase(),
}));

// Plain array — easiest for Firebase, MongoDB, or a custom loader.
writeFileSync(join(seedDir, 'products.json'), JSON.stringify(dbBooks, null, 2) + '\n');

// DynamoDB BatchWriteItem payloads, 25 items per file (the API's hard limit).
// Table name must match tools/aws/tables/products.json.
const TABLE = 'Paperbound-Products';
const chunks = [];
for (let i = 0; i < dbBooks.length; i += 25) chunks.push(dbBooks.slice(i, i + 25));
chunks.forEach((chunk, i) => {
  const payload = {
    [TABLE]: chunk.map((b) => ({
      PutRequest: {
        Item: {
          id: { S: b.id },
          title: { S: b.title },
          author: { S: b.author },
          category: { S: b.category },
          price: { N: String(b.price) },
          stock: { N: String(b.stock) },
          isbn: { S: b.isbn },
          publishedYear: { N: String(b.publishedYear) },
          coverUrl: { S: b.coverUrl },
          description: { S: b.description },
          searchText: { S: b.searchText },
        },
      },
    })),
  };
  writeFileSync(join(seedDir, `dynamodb-batch-${i + 1}.json`), JSON.stringify(payload, null, 2) + '\n');
});

// SQL for an RDS/Postgres/MySQL table.
const sqlEsc = (s) => String(s).replace(/'/g, "''");
const sql = `-- Seed data for the products table (INFS803 Assignment 2)
CREATE TABLE IF NOT EXISTS products (
  id             VARCHAR(16) PRIMARY KEY,
  title          VARCHAR(255) NOT NULL,
  author         VARCHAR(255) NOT NULL,
  category       VARCHAR(64)  NOT NULL,
  price          DECIMAL(8,2) NOT NULL,
  stock          INT          NOT NULL DEFAULT 0,
  isbn           VARCHAR(24),
  published_year INT,
  cover_url      VARCHAR(512),
  description    TEXT,
  search_text    TEXT
);

INSERT INTO products (id, title, author, category, price, stock, isbn, published_year, cover_url, description, search_text) VALUES
${dbBooks
  .map(
    (b) =>
      `('${b.id}', '${sqlEsc(b.title)}', '${sqlEsc(b.author)}', '${sqlEsc(b.category)}', ${b.price}, ${b.stock}, '${b.isbn}', ${b.publishedYear}, '${b.coverUrl}', '${sqlEsc(b.description)}', '${sqlEsc(b.searchText)}')`
  )
  .join(',\n')};
`;
writeFileSync(join(seedDir, 'products.sql'), sql);

const categories = [...new Set(books.map((b) => b.category))];
console.log(`${books.length} books across ${categories.length} categories`);
console.log(`categories: ${categories.join(', ')}`);
console.log(`covers:     public/covers/*.svg`);
console.log(`seed data:  tools/seed-data/ (products.json, products.sql, ${chunks.length} DynamoDB batches)`);
console.log(`price range: $${Math.min(...books.map((b) => b.price)).toFixed(2)} – $${Math.max(...books.map((b) => b.price)).toFixed(2)}`);
console.log(`out of stock: ${books.filter((b) => b.stock === 0).length}`);
