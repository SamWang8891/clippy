// node --test src/utils/time.test.js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatClock} from './time.js';

const evening = new Date(2026, 9, 12, 19, 15);

test('puts a space between the day period and the digits in zh-TW', () => {
    assert.equal(formatClock(evening, 'zh-TW'), '下午 07:15');
    assert.equal(formatClock(new Date(2026, 9, 12, 9, 5), 'zh-TW'), '上午 09:05');
});

test('leaves locales that already space it out alone', () => {
    assert.equal(formatClock(evening, 'ko-KR'), '오후 07:15');
    const us = formatClock(evening, 'en-US');
    assert.match(us, /^07:15\s+PM$/u);
    assert.doesNotMatch(us, /\s{2}/u);
});

test('has nothing to add on a 24-hour clock', () => {
    assert.equal(formatClock(evening, 'en-GB'), '19:15');
});
