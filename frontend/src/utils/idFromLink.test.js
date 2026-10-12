// node --test src/utils/idFromLink.test.js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {idFromLink} from './idFromLink.js';

test('takes the last part of a link\'s path', () => {
    assert.equal(idFromLink('https://clippy.example.com/abc123'), 'abc123');
    assert.equal(idFromLink('  http://localhost:3000/XyZ789/  '), 'XyZ789');
    assert.equal(idFromLink('https://clippy.example.com/abc123?ref=qr#top'), 'abc123');
    assert.equal(idFromLink('HTTPS://clippy.example.com/deep/path/qwe456'), 'qwe456');
});

test('a link with no path has no ID', () => {
    assert.equal(idFromLink('https://clippy.example.com/'), '');
});

test('anything else is not a link', () => {
    assert.equal(idFromLink('abc123'), null);
    assert.equal(idFromLink('clippy.example.com/abc123'), null);
    assert.equal(idFromLink('https://'), null);
});
