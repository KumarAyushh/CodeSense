const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveInWorkspace } = require('../src/tools');

describe('resolveInWorkspace', () => {
  let base, root, outside;

  before(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codesense-test-')));
    root = path.join(base, 'workspace');
    outside = path.join(base, 'outside');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(outside);
    // 'junction' needs no admin rights on Windows and is ignored elsewhere
    fs.symlinkSync(outside, path.join(root, 'link'), 'junction');
  });

  after(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('resolves relative paths inside the workspace', () => {
    assert.equal(resolveInWorkspace(root, 'src/app.js'), path.join(root, 'src', 'app.js'));
  });

  it('accepts absolute paths inside the workspace', () => {
    const full = path.join(root, 'src', 'app.js');
    assert.equal(resolveInWorkspace(root, full), full);
  });

  it('accepts the workspace root itself', () => {
    assert.equal(resolveInWorkspace(root, '.'), root);
    assert.equal(resolveInWorkspace(root, root), root);
  });

  it('accepts paths that do not exist yet', () => {
    const full = path.join(root, 'new', 'deep', 'file.js');
    assert.equal(resolveInWorkspace(root, 'new/deep/file.js'), full);
  });

  it('accepts names that only start with two dots', () => {
    assert.equal(resolveInWorkspace(root, '..config/a.js'), path.join(root, '..config', 'a.js'));
  });

  it('accepts ../ that stays inside the workspace', () => {
    assert.equal(resolveInWorkspace(root, 'src/../README.md'), path.join(root, 'README.md'));
  });

  it('rejects ../ escapes', () => {
    assert.throws(() => resolveInWorkspace(root, '../outside/secret.txt'), /Path outside workspace/);
    assert.throws(() => resolveInWorkspace(root, 'src/../../outside'), /Path outside workspace/);
    assert.throws(() => resolveInWorkspace(root, '..'), /Path outside workspace/);
  });

  it('rejects absolute paths outside the workspace', () => {
    assert.throws(() => resolveInWorkspace(root, path.join(outside, 'secret.txt')), /Path outside workspace/);
  });

  it('rejects a sibling folder that shares the workspace name as a prefix', () => {
    assert.throws(() => resolveInWorkspace(root, `${root}-evil/secret.txt`), /Path outside workspace/);
  });

  it('rejects paths through a symlink that leaves the workspace', () => {
    assert.throws(() => resolveInWorkspace(root, 'link/secret.txt'), /Path outside workspace/);
    assert.throws(() => resolveInWorkspace(root, 'link/new/file.txt'), /Path outside workspace/);
  });
});
