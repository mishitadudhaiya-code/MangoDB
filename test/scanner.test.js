/**
 * test/scanner.test.js — Tests for Step 9 Source Scanner (4 patterns)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { scanSourceFiles } = require('../src/engine/scanner');

describe('Step 9: Source Scanner (4 Patterns)', () => {
  it('Pattern 1: detects fetch/axios calls to /api/... and creates API edges', () => {
    const files = [
      {
        path: 'src/pages/UserProfile.js',
        content: `
          async function loadProfile() {
            const res = await fetch('/api/users/profile');
            const data = await res.json();
            return data;
          }
        `
      }
    ];

    const result = scanSourceFiles(files);
    assert.equal(result.valid, true);
    const apiComp = result.manifest.components.find(c => c.type === 'api');
    assert.ok(apiComp, 'Should create an api component');
    assert.equal(apiComp.name, '/api/users/profile');

    const callEdge = result.manifest.edges.find(e => e.to === apiComp.id);
    assert.ok(callEdge, 'Should create a calls edge to the API');
    assert.equal(callEdge.kind, 'calls');
  });

  it('Pattern 2: detects static property reads (data.user_name and data["email"])', () => {
    const files = [
      {
        path: 'src/services/billing.js',
        content: `
          function processUser(data) {
            console.log(data.user_name);
            const email = data["email"];
          }
        `
      }
    ];

    const result = scanSourceFiles(files);
    assert.equal(result.valid, true);

    const userNameField = result.manifest.components.find(c => c.name === 'user_name');
    assert.ok(userNameField, 'Should extract user_name field');
    assert.equal(userNameField.type, 'field');

    const emailField = result.manifest.components.find(c => c.name === 'email');
    assert.ok(emailField, 'Should extract email field from bracket string');

    const readEdge = result.manifest.edges.find(e => e.to === userNameField.id);
    assert.ok(readEdge);
    assert.equal(readEdge.dynamic, false);
  });

  it('Pattern 3: detects dynamic bracket access (data[key]) and creates dynamic: true edge', () => {
    const files = [
      {
        path: 'src/views/Analytics.js',
        content: `
          function getMetric(data, metricKey) {
            return data[metricKey];
          }
        `
      }
    ];

    const result = scanSourceFiles(files);
    assert.equal(result.valid, true);

    const dynEdge = result.manifest.edges.find(e => e.dynamic === true);
    assert.ok(dynEdge, 'Should mark dynamic bracket access as dynamic: true');
  });

  it('Pattern 4: detects function definitions and calls between files', () => {
    const files = [
      {
        path: 'src/utils/format.js',
        content: `
          function formatDisplayName(user) {
            return user.first_name + " " + user.last_name;
          }
        `
      },
      {
        path: 'src/pages/Dashboard.js',
        content: `
          function render() {
            return formatDisplayName({ first_name: "Alice" });
          }
        `
      }
    ];

    const result = scanSourceFiles(files);
    assert.equal(result.valid, true);

    const fnComp = result.manifest.components.find(c => c.id === 'fn.formatDisplayName');
    assert.ok(fnComp, 'Should create function component');

    const crossCallEdge = result.manifest.edges.find(e => e.from === 'src_pages_Dashboard.js' && e.to === 'fn.formatDisplayName');
    assert.ok(crossCallEdge, 'Should create call edge from Dashboard to formatDisplayName');
  });
});
