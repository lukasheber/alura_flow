// Behaviour of the real background.js (see helpers/background-harness.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBackground } from './helpers/background-harness.mjs';

const inCourse = { controlledTabId: 7, latestState: { mode: 'PLAYER', data: { courseId: 'javascript' } } };

test('with per-course speeds on, a course speed leaves the default speed alone', async () => {
    const background = await loadBackground({ local: { playbackSpeed: 1, perCourseSettings: true }, session: inCourse });
    const response = await background.send({ type: 'UPDATE_SPEED', speed: 2 });
    assert.equal(response.ok, true);
    assert.equal(background.stores.local.playbackSpeed, 1);
    assert.equal(background.stores.local.courseProfiles.javascript.playbackSpeed, 2);
    assert.deepEqual(background.tabMessages.at(-1), { tabId: 7, message: { type: 'UPDATE_SPEED', speed: 2 } });
});

test('with per-course speeds off, a new speed becomes the default', async () => {
    const background = await loadBackground({ local: { playbackSpeed: 1, perCourseSettings: false }, session: inCourse });
    await background.send({ type: 'UPDATE_SPEED', speed: 1.75 });
    assert.equal(background.stores.local.playbackSpeed, 1.75);
    assert.equal(background.stores.local.courseProfiles, undefined);
});

test('the speed shortcut cycles from the course speed and keeps it on the course', async () => {
    const background = await loadBackground({
        local: { playbackSpeed: 1, perCourseSettings: true, shortcutsEnabled: true, courseProfiles: { javascript: { playbackSpeed: 1.5 } } },
        session: inCourse
    });
    await background.send({ type: 'CYCLE_SPEED_REQUEST' });
    assert.equal(background.stores.local.courseProfiles.javascript.playbackSpeed, 2);
    assert.equal(background.stores.local.playbackSpeed, 1);
});

test('a speed change made in the player is stored on its course', async () => {
    const background = await loadBackground({ local: { playbackSpeed: 1, perCourseSettings: true }, session: inCourse });
    await background.send({ type: 'SPEED_UPDATED', speed: 1.25, courseId: 'javascript' });
    assert.equal(background.stores.local.courseProfiles.javascript.playbackSpeed, 1.25);
    assert.equal(background.stores.local.playbackSpeed, 1);
});
