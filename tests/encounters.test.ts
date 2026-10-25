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
  assert.ok(expected.id.startsWith('encounter-v3:'));
  assert.equal(expected.coinValue, 1);
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


test('independent encounters remain deterministic with sparse coins and rare equipment', () => {
  const counts = new Set<number>();
  const coinIds = new Set<string>();
  const appearances = new Set<string>();
  let coins = 0;
  let equipment = 0;
  let both = 0;
  let empty = 0;
  for (let index = 0; index < 50000; index++) {
    const logicalKey = `independent:${index}`;
    const encounter = encounterForPlatform(PAGE, logicalKey);
    if (encounter.coinCount > 0) {
      coins++;
      assert.ok(encounter.id.startsWith('encounter-v3:'));
      assert.ok(encounter.coinCount >= 3 && encounter.coinCount <= 7);
      counts.add(encounter.coinCount);
      for (let coin = 0; coin < encounter.coinCount; coin++) {
        const claim = coinId(encounter, coin);
        assert.equal(claim, `${encounter.id}:coin:${coin}`);
        assert.ok(!coinIds.has(claim));
        coinIds.add(claim);
      }
    }
    if (encounter.equipment) {
      equipment++;
      assert.ok(encounter.equipment.jumpMultiplier >= 1.2 && encounter.equipment.jumpMultiplier <= 1.9);
      assert.equal(encounter.equipment.slot, 'boots');
      assert.equal(encounter.equipment.id, `${encounter.equipment.name.toLowerCase().replaceAll(' ', '-')}:${encounter.equipment.rarity}:boots`);
      appearances.add(`${encounter.equipment.name}:${encounter.equipment.color}:${encounter.equipment.jumpMultiplier}`);
    }
    if (encounter.coinCount > 0 && encounter.equipment) both++;
    if (encounter.coinCount === 0 && encounter.equipment === null) empty++;
    if (index < 100) assert.deepEqual(encounterForPlatform(PAGE, logicalKey), encounter);
  }
  assert.deepEqual([...counts].sort(), [3, 4, 5, 6, 7]);
  assert.ok(coins > 3500 && coins < 6500, `coin outcomes: ${coins}/50000`);
  assert.ok(equipment > 60 && equipment < 200, `expected about 125 equipment outcomes: ${equipment}/50000`);
  assert.ok(both > 0, 'some platforms independently win both coins and equipment');
  assert.ok(coins > both, 'coin-only outcomes exist');
  assert.ok(equipment > both, 'equipment-only outcomes exist');
  assert.ok(empty > 40000);
  assert.ok(appearances.size >= 3 && appearances.size <= 5);
});

test('discovery excludes empty encounters even when supplied nonexistent coin claims', () => {
  let empty;
  for (let index = 0; index < 10000; index++) {
    const encounter = encounterForPlatform(PAGE, `empty:${index}`);
    if (encounter.coinCount === 0 && encounter.equipment === null) { empty = encounter; break; }
  }
  assert.ok(empty);
  const platform: Platform = { id: 'empty', logicalKey: empty.logicalKey, x: 0, y: 500, width: 100 };
  const claimed = new Set([coinId(empty, 0)]);
  assert.deepEqual(discoverEncounters(PAGE, [platform]), []);
  assert.deepEqual(discoverEncounters(PAGE, [platform], [empty], claimed), []);
});


test('social-site content queries change identity while share and challenge parameters do not', () => {
  for (const [host, parameter] of [['www.reddit.com', 'sort'], ['www.tiktok.com', 'q'], ['www.instagram.com', 'img_index']]) {
    const base = `https://${host}/content?${parameter}=one`;
    assert.notEqual(pageSeedKey(base), pageSeedKey(`https://${host}/content?${parameter}=two`));
    assert.equal(pageSeedKey(base), pageSeedKey(`${base}&utm_source=share&igsh=tracking&js_challenge=1&jsc_token=transient#anchor`));
  }
});
