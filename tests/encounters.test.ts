import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coinId, encounterForUrl } from '../src/encounters';
import { pageSeedKey } from '../src/page-identity';

const PAGE = 'https://example.com:8443/article?q=steam+engine&tag=steel&tag=brass#results';

test('encounters share the complete normalized page identity, not path or viewport', () => {
  const expected = encounterForUrl(PAGE);
  const equivalent = 'http://example.com:8443/another/path?tag=brass&utm_source=mail&tag=steel&q=steam%20engine#results';
  assert.deepEqual(encounterForUrl(equivalent), expected);
  assert.deepEqual(encounterForUrl(PAGE), expected);
  assert.equal(expected.seedKey, pageSeedKey(PAGE));
  assert.equal(expected.coinCount, 3);
  assert.equal(expected.coinValue, 5);
  assert.equal(expected.xpPerCoin, 20);
});

test('Google changing tracking timestamps never creates a new reward claim', () => {
  const base = 'https://www.google.com/search?q=steam+engine#results';
  const tracked = 'http://www.google.com/different?q=steam+engine&zx=123&ei=456&sei=789&ved=click&utm_medium=ad#results';
  assert.deepEqual(encounterForUrl(tracked), encounterForUrl(base));
  for (const name of ['zx', 'ei', 'sei', 'source']) {
    assert.notEqual(pageSeedKey(`https://example.com/?${name}=one`), pageSeedKey(`https://example.com/?${name}=two`));
  }
});

test('duplicate query values sort without collapsing identity boundaries', () => {
  assert.equal(pageSeedKey('https://example.com/?tag=b&tag=a&tag=a'), pageSeedKey('http://example.com/path?tag=a&tag=b&tag=a'));
  const variants = [
    PAGE.replace('example.com', 'sub.example.com'),
    PAGE.replace(':8443', ':9443'),
    PAGE.replace('steam+engine', 'spring+boots'),
    PAGE.replace('tag=brass', 'tag=steel'),
    PAGE.replace('tag=brass', 'tag=brass&tag=brass'),
    PAGE.replace('#results', '#inventory'),
    PAGE.replace('q=steam+engine', 'Q=steam+engine'),
  ];
  for (const url of variants) {
    assert.notEqual(encounterForUrl(url).id, encounterForUrl(PAGE).id);
  }
  assert.notEqual(encounterForUrl('https://example.com/?a=b%26c%3Dd').id,
    encounterForUrl('https://example.com/?a=b&c=d').id);
});

test('persistent encounter, coin, and equipment IDs retain the complete canonical identity', () => {
  const topics = ['steam engines', 'spring boots', 'native platforms', 'railway sleepers', 'copper gears'];
  const encounters = Array.from({ length: 400 }, (_, index) =>
    encounterForUrl(`https://example.com/search?q=${encodeURIComponent(topics[index % topics.length]!)}&edition=${index}`));
  const ids = new Set<string>();
  for (const encounter of encounters) {
    assert.ok(encounter.id.startsWith('encounter-v1:'));
    assert.ok(encounter.id.includes(encounter.seedKey));
    ids.add(encounter.id);
    for (let index = 0; index < encounter.coinCount; index++) {
      const id = coinId(encounter, index);
      assert.ok(id.includes(encounter.seedKey));
      ids.add(id);
    }
    if (encounter.equipment) {
      assert.ok(encounter.equipment.id.includes(encounter.seedKey));
      ids.add(encounter.equipment.id);
    }
  }
  const rare = encounters.filter(encounter => encounter.equipment !== null);
  assert.equal(ids.size, encounters.length * 4 + rare.length);
  assert.ok(rare.length >= 20 && rare.length <= 65, `expected roughly one in ten rare pages, got ${rare.length}/400`);
  assert.ok(new Set(rare.map(encounter => encounter.equipment!.name)).size > 1);
  for (const encounter of rare) {
    const equipment = encounter.equipment!;
    assert.equal(equipment.rarity, 'rare');
    assert.equal(equipment.slot, 'boots');
    assert.equal(equipment.jumpMultiplier, 1.2);
    assert.match(equipment.description, /20%/);
    assert.match(equipment.description, /44%/);
    // Regeneration must reproduce actual equipment attributes, not just its ID.
    const [, pairs, fragment] = JSON.parse(encounter.seedKey) as [string, [string, string][], string];
    const url = `https://example.com/other?${new URLSearchParams(pairs)}${fragment}`;
    assert.deepEqual(encounterForUrl(url), encounter);
  }
  assert.ok(encounters.some(encounter => encounter.equipment === null), 'ordinary pages must not grant free equipment');
});
