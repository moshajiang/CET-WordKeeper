import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositories = [
  ['origin', 'https://github.com/moshajiang/CET-WordKeeper.git'],
  ['gitee', 'https://gitee.com/moyunyi/cet-word-keeper.git'],
];

export function pushAll(run, log = console.log) {
  const branch = run(['symbolic-ref', '--quiet', '--short', 'HEAD']).trim();
  if (!branch || branch.startsWith('-')) throw Error('请切换到要同步的本地分支');
  if (run(['status', '--porcelain']).trim()) throw Error('请先提交工作区改动，再同步两个仓库');
  const commit = run(['rev-parse', 'HEAD']).trim();
  for (const [remote, expected] of repositories) {
    const urls = run(['remote', 'get-url', '--push', '--all', remote]).trim().split(/\r?\n/);
    if (urls.length !== 1 || urls[0] !== expected) throw Error(`${remote} 的推送地址与项目仓库不一致，请检查远程配置`);
    run(['push', '--dry-run', remote, `HEAD:refs/heads/${branch}`]);
  }
  const results = [];
  for (const [remote] of repositories) {
    try {
      run(['push', remote, `HEAD:refs/heads/${branch}`]);
      const refs = run(['ls-remote', '--heads', remote, `refs/heads/${branch}`]).trim().split(/\s+/);
      if (refs[0] !== commit) throw Error('推送后远程提交未与本地一致');
      results.push({ remote, ok: true });
      log(`✓ ${remote}: ${branch} @ ${commit}`);
    } catch {
      results.push({ remote, ok: false });
      log(`✗ ${remote}: 推送或远程校验失败，请检查上方 Git 错误后重试`);
    }
  }
  if (results.some(result => !result.ok)) throw Error('双仓库同步未全部完成；已成功的推送保留，可安全重跑');
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const run = args => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
      stdio: ['ignore', 'pipe', 'inherit'] });
    if (result.error || result.status !== 0) throw Error('Git 操作失败：'+args.slice(0,2).join(' '));
    return result.stdout;
  };
  try { pushAll(run); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
