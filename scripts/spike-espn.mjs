#!/usr/bin/env node
/**
 * ESPN NFL scoreboard spike.
 *
 * WHY THIS IS A SCRIPT AND NOT A RESULT
 *
 * The cloud session that scaffolded this repo could not reach
 * site.api.espn.com — the environment's network egress policy denies it, for
 * both curl and any fetch (403 at the proxy, `connect_rejected`). So rather
 * than guessing at the response shape and building on the guess, the spike
 * ships as something you run on your own machine:
 *
 *     node scripts/spike-espn.mjs 8
 *     node scripts/spike-espn.mjs 8 --json > week8.json
 *
 * WHAT IT NEEDS TO ANSWER, before anything is built on top of it:
 *
 *   1. Does competitions[0].odds[] carry a spread, and in what shape?
 *      A `details: "KC -3.5"` string and a numeric `spread` field imply very
 *      different parsing, and the string form needs the abbreviation resolved
 *      to home or away before its sign means anything.
 *   2. Is the spread present for FUTURE weeks? The pick sheet has to show a
 *      line while the games are still days away.
 *   3. Is the line still there once a game is FINAL, or does it vanish?
 *
 * Question 3 is the one that decides the schema, and this repo has already
 * assumed the pessimistic answer: `games.spread` stores the line rather than
 * re-fetching it. That is correct either way, and the hooking rule makes it
 * doubly so — a stored, hooked line is the pool's own number, not the market's.
 *
 * There is no free official NFL API equivalent to the NHL one this project's
 * sibling uses, which is why this undocumented endpoint is the candidate. It
 * can change without notice. Treat whatever you learn here as perishable and
 * pin the parsing behind netlify/functions/nfl-schedule.ts.
 */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const week = Number(args.find(a => /^\d+$/.test(a)) ?? 1);
const season = Number(
  (args.find(a => a.startsWith('--season=')) ?? '').split('=')[1] || new Date().getFullYear()
);

if (!Number.isInteger(week) || week < 1 || week > 18) {
  console.error('Usage: node scripts/spike-espn.mjs <week 1-18> [--season=2026] [--json]');
  process.exit(1);
}

// seasontype=2 is the regular season (1 = pre, 3 = post).
const url = `${BASE}?dates=${season}&seasontype=2&week=${week}`;

const response = await fetch(url);
if (!response.ok) {
  console.error(`ESPN returned ${response.status} for ${url}`);
  process.exit(1);
}
const data = await response.json();

if (asJson) {
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}

const events = data.events ?? [];

console.log(`\n=== ${url}`);
console.log(`season=${JSON.stringify(data.season)} week=${JSON.stringify(data.week)}`);
console.log(`${events.length} events\n`);

let withOdds = 0;

for (const event of events) {
  const comp = event.competitions?.[0];
  if (!comp) continue;

  const home = comp.competitors?.find(c => c.homeAway === 'home');
  const away = comp.competitors?.find(c => c.homeAway === 'away');
  const odds = comp.odds?.[0];
  if (odds) withOdds++;

  console.log(`${away?.team?.abbreviation ?? '???'} @ ${home?.team?.abbreviation ?? '???'}`);
  console.log(`  id         ${event.id}`);
  console.log(`  kickoff    ${event.date}`);
  console.log(`  status     ${comp.status?.type?.name}  (completed=${comp.status?.type?.completed})`);
  console.log(`  score      ${away?.score ?? '-'} - ${home?.score ?? '-'}`);

  if (odds) {
    // Print every key, not a curated subset — the point of a spike is to find
    // out what is actually there, including fields nobody expected.
    console.log(`  odds keys  ${Object.keys(odds).join(', ')}`);
    console.log(`  provider   ${odds.provider?.name ?? '(none)'}`);
    console.log(`  details    ${JSON.stringify(odds.details)}`);
    console.log(`  spread     ${JSON.stringify(odds.spread)}`);
    console.log(`  overUnder  ${JSON.stringify(odds.overUnder)}`);
    if (odds.homeTeamOdds || odds.awayTeamOdds) {
      console.log(`  homeOdds   ${JSON.stringify(odds.homeTeamOdds)}`);
      console.log(`  awayOdds   ${JSON.stringify(odds.awayTeamOdds)}`);
    }
  } else {
    console.log('  odds       (ABSENT)');
  }
  console.log('');
}

console.log('--- Answers to carry back into nfl-schedule.ts ---');
console.log(`Q1  odds present on ${withOdds}/${events.length} events`);
console.log(`Q2  run this for a FUTURE week and check that number again`);
console.log(`Q3  run it for a COMPLETED week and check whether odds survive`);
console.log('');
console.log('Also check: is `spread` numeric and signed relative to HOME?');
console.log('If only `details` ("KC -3.5") exists, the abbreviation must be');
console.log('resolved to home/away before the sign means anything. Verify');
console.log('against a game where the AWAY team is favoured — that is the case');
console.log('most likely to be silently inverted.');
