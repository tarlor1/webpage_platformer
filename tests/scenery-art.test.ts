import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sceneryDesigns } from '../src/rendering/scenery-art';
import { pageSeedKey } from '../src/page/page-identity';

const PAGE = 'https://example.com:8443/article?mode=steam&tag=brass&tag=steel#engine';

test('page identity ignores protocol, unknown queries, fragments, and tracking on the same path', () => {
  const equivalent = 'http://example.com:8443/article?tag=steel&utm_source=news&mode=steam'
    + '&gclid=ads&tag=brass&fbclid=social&UTM_CAMPAIGN=launch&msclkid=click'
    + '&dclid=display&gbraid=ad&wbraid=ad&yclid=ad&igshid=social&mc_cid=mail'
    + '&mc_eid=mail&_ga=analytics&_gl=analytics&srsltid=shop#engine';
  assert.equal(pageSeedKey(equivalent), pageSeedKey(PAGE));
  assert.deepEqual(sceneryDesigns(equivalent), sceneryDesigns(PAGE));
  assert.equal(pageSeedKey('https://EXAMPLE.com/one'), pageSeedKey('http://example.com/one'));
  assert.equal(pageSeedKey('https://example.com/?q=steam+engine'),
    pageSeedKey('https://example.com/?q=steam%20engine'));
});

test('host, port and meaningful pathname remain identity boundaries', () => {
  const variants = [
    PAGE.replace('example.com', 'other.example.com'),
    PAGE.replace(':8443', ':8444'),
    PAGE.replace('/article', '/Article'),
    PAGE.replace('/article', '/article/'),
    PAGE.replace('/article', '/other'),
  ];
  for (const url of variants) {
    assert.notEqual(pageSeedKey(url), pageSeedKey(PAGE));
    assert.notDeepEqual(sceneryDesigns(url), sceneryDesigns(PAGE));
  }
});

test('seed keys do not conflate query delimiters with encoded values', () => {
  assert.notEqual(pageSeedKey('https://www.google.com/search?q=b%26start%3D20'),
    pageSeedKey('https://www.google.com/search?q=b&start=20'));
});

test('the same URL reproduces the same decoration identities and attributes', () => {
  assert.deepEqual(sceneryDesigns(PAGE), sceneryDesigns(PAGE));
});

test('surface decorations remain thin instead of becoming page backgrounds', () => {
  for (let index = 0; index < 100; index++) {
    for (const design of sceneryDesigns(`https://example.com/edition/${index}`)) {
      assert.ok(design.height > 0 && design.height <= 12);
      assert.ok(design.width >= 30);
    }
  }
});

test('URL variation changes actual artwork attributes, not only design IDs', () => {
  const appearances = Array.from({ length: 20 }, (_, edition) =>
    sceneryDesigns(`https://example.com/edition/${edition}`).map(({ id, rank, ...appearance }) => appearance));
  assert.ok(new Set(appearances.map(appearance => JSON.stringify(appearance))).size > 1);
});

test('Google tracking timestamps do not change query-specific decoration designs', () => {
  const base = 'https://www.google.com/search?q=steam+engine#results';
  const tracked = `${base.replace('#results', '')}&sei=time-one&ei=time-two&zx=cache-buster&ved=click&sourceid=chrome#results`;
  assert.deepEqual(sceneryDesigns(base), sceneryDesigns(tracked));
  assert.notDeepEqual(sceneryDesigns(base), sceneryDesigns(base.replace('steam+engine', 'brass+gears')));
  assert.equal(pageSeedKey('https://example.com/?source=one'), pageSeedKey('https://example.com/?source=two'));
  assert.equal(pageSeedKey('https://example.com/?zx=one'), pageSeedKey('https://example.com/?zx=two'));
});
