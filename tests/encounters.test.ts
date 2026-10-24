import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coinId, discoverEncounters, encounterForPlatform, populatedEncounter } from '../src/progression/encounters';
import { pageSeedKey } from '../src/page/page-identity';
import type { Platform } from '../src/engine/types';

const PAGE = 'https://www.google.com/search?q=steam+engine&tbm=isch&start=20#results';
const KEY = 'article:steam-engine';

test('platform rewards retain both canonical URL and complete logical identity', () => {
  const expected = encounterForPlatform(PAGE, KEY);
  assert.deepEqual(encounterForPlatform('http://www.google.com/search?start=20&utm_source=mail&tbm=isch&q=steam%20engine#other', KEY), expected);
  assert.equal(expected.seedKey, pageSeedKey(PAGE));
  assert.equal(expected.logicalKey, KEY);
  assert.ok(expected.id.startsWith('encounter-v2:'));
  assert.ok(expected.coinCount >= 3 && expected.coinCount <= 7);
  assert.equal(expected.coinValue, 5);
  assert.equal(expected.xpPerCoin, 20);
  for (const [url, key] of [[PAGE.replace('/search', '/Search'), KEY], [PAGE, `${KEY}:other`],
    [PAGE.replace('start=20', 'start=40'), KEY], [PAGE.replace('tbm=isch', 'tbm=vid'), KEY],
    [PAGE.replace('steam+engine', 'brass+gears'), KEY]]) {
    assert.notEqual(encounterForPlatform(url!, key!).id, expected.id);
  }
});

test('path identity preserves case, trailing slash, and encoded separators safely', () => {
  const base = 'https://example.com/Article';
  for (const path of ['/article', '/Article/', '/Article/chapter', '/Article%2Fchapter']) {
    assert.notEqual(pageSeedKey(base), pageSeedKey(`https://example.com${path}`));
  }
  assert.notEqual(pageSeedKey('https://example.com/a%2Fb'), pageSeedKey('https://example.com/a/b'));
  assert.equal(pageSeedKey('https://EXAMPLE.com/a/../%41rticle#heading'), pageSeedKey(base));
  assert.equal(pageSeedKey('https://example.com/a%2fb'), pageSeedKey('https://example.com/a%2Fb'));
});

test('query adapters retain only explicit content parameters and ignore fragments and tracking', () => {
  assert.equal(pageSeedKey('https://example.com/article?q=one&edition=2#one'), pageSeedKey('https://example.com/article?q=two&utm_source=mail#two'));
  assert.equal(pageSeedKey(`${PAGE.replace('#results', '')}&zx=123&ei=456&sei=789&ved=click#other`), pageSeedKey(PAGE));
  assert.equal(pageSeedKey('https://www.google.co.uk/search?q=steam+engine&start=0'), pageSeedKey('http://www.google.co.uk/search?start=0&q=steam%20engine&unknown=anything'));
  assert.notEqual(pageSeedKey('https://www.youtube.com/watch?v=one'), pageSeedKey('https://www.youtube.com/watch?v=two'));
  assert.notEqual(pageSeedKey('https://en.wikipedia.org/w/index.php?title=One'), pageSeedKey('https://en.wikipedia.org/w/index.php?title=Two'));
  assert.equal(pageSeedKey('https://google.com.evil.test/?q=one'), pageSeedKey('https://google.com.evil.test/?q=two'));
  assert.notEqual(pageSeedKey('https://www.google.com/search?q=a%26start%3D20'), pageSeedKey('https://www.google.com/search?q=a&start=20'));
  assert.equal(pageSeedKey('https://www.google.com/search?q=b&q=a&q=a'), pageSeedKey('https://www.google.com/search?q=a&q=b&q=a'));
  assert.throws(() => pageSeedKey('file:///article'), /HTTP/);
});

test('content query rules inherit across subdomains without matching lookalike domains', () => {
  for (const [host, parameter] of [['m.youtube.com', 'v'], ['en.m.wikipedia.org', 'title'], ['www.google.de', 'q']]) {
    assert.notEqual(pageSeedKey(`https://${host}/content?${parameter}=one`),
      pageSeedKey(`https://${host}/content?${parameter}=two`));
  }
  for (const host of ['notyoutube.com', 'wikipedia.org.evil.test', 'google.de.evil.test']) {
    assert.equal(pageSeedKey(`https://${host}/content?v=one&title=one&q=one`),
      pageSeedKey(`https://${host}/content?v=two&title=two&q=two`));
  }
});

test('discovery merges new logical keys, deduplicates wraps/clones and ignores geometry ordering', () => {
  const keys: string[] = [];
  for (let index = 0; keys.length < 2; index++) {
    const key = `discovered:${index}`;
    if (populatedEncounter(encounterForPlatform(PAGE, key))) keys.push(key);
  }
  const first: Platform = { id: 'physical-a', logicalKey: keys[0], x: 0, y: 500, width: 100 };
  const wrapped: Platform = { ...first, id: 'wrap', x: 300, width: 20 };
  const second: Platform = { ...first, id: 'physical-b', logicalKey: keys[1] };
  const known = discoverEncounters(PAGE, [first, wrapped]);
  assert.equal(known.length, 1);
  assert.deepEqual(discoverEncounters(PAGE, [wrapped, first]), known);
  const merged = discoverEncounters(PAGE, [second], known);
  assert.equal(merged.length, 2);
  assert.ok(merged.includes(known[0]!));
  assert.deepEqual(discoverEncounters(PAGE, [], merged), merged);
  assert.deepEqual(discoverEncounters(PAGE, [{ ...first, width: 6000, x: -900, y: -200 }]), known);
  assert.deepEqual(discoverEncounters(PAGE, [{ ...first, logicalKey: undefined }]), []);
  assert.deepEqual(discoverEncounters(PAGE, [{ ...first, width: 2 }]), []);
});

test('3–7 coin sets and approximately one-percent equipment rolls vary by platform on the same URL', () => {
  const counts = new Set<number>();
  const ids = new Set<string>();
  let gear = 0;
  const appearances = new Set<string>();
  for (let index = 0; index < 10000; index++) {
    const encounter = encounterForPlatform(PAGE, `logical:${index}`);
    assert.deepEqual(encounterForPlatform(PAGE, `logical:${index}`), encounter);
    counts.add(encounter.coinCount);
    for (let coin = 0; coin < encounter.coinCount; coin++) {
      const id = coinId(encounter, coin);
      assert.ok(!ids.has(id));
      ids.add(id);
    }
    if (encounter.equipment) {
      gear++;
      assert.ok(encounter.equipment.jumpMultiplier >= 1.15 && encounter.equipment.jumpMultiplier <= 1.25);
      assert.ok(encounter.equipment.id.startsWith(encounter.id));
      appearances.add(`${encounter.equipment.name}:${encounter.equipment.color}:${encounter.equipment.jumpMultiplier}`);
    }
  }
  assert.deepEqual([...counts].sort(), [3, 4, 5, 6, 7]);
  assert.ok(gear > 50 && gear < 160, `expected about 1% rare platforms, received ${gear}/10000`);
  assert.ok(appearances.size > 10);
});

test('population stays sparse while preserving rare platforms and started reward sets', () => {
  let populated = 0;
  let empty;
  for (let index = 0; index < 10000; index++) {
    const encounter = encounterForPlatform(PAGE, `population:${index}`);
    const selected = populatedEncounter(encounter);
    if (selected) populated++;
    else empty ??= encounter;
    if (encounter.equipment) assert.equal(selected, true);
  }
  assert.ok(populated >= 500 && populated < 2000, `sparse platform population: ${populated}/10000`);
  assert.ok(empty);
  const platform: Platform = { id: 'started', logicalKey: empty.logicalKey, x: 0, y: 500, width: 100 };
  assert.deepEqual(discoverEncounters(PAGE, [platform]), []);
  const claimed = new Set([coinId(empty, 0)]);
  assert.deepEqual(discoverEncounters(PAGE, [platform], [], claimed), [empty]);
  assert.deepEqual(discoverEncounters(PAGE, [platform], [empty]), []);
  assert.deepEqual(discoverEncounters(PAGE, [platform], [empty], claimed), [empty]);
});
