const { createRequire } = require('node:module');

const SOURCES = Object.freeze({
  github: Object.freeze({ name: 'GitHub', url: 'https://github.com/moshajiang/CET-WordKeeper/releases/latest' }),
  gitee: Object.freeze({ name: '码云 Gitee', url: 'https://gitee.com/moyunyi/cet-word-keeper/releases' }),
});
const GITEE_API = 'https://gitee.com/api/v5/repos/moyunyi/cet-word-keeper/releases';
let GiteeProvider;

function httpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw Error('更新附件必须使用无凭据的 HTTPS 地址');
  return url;
}

// 延迟加载：沿用 electron-updater 自己的 Provider、YAML 和 semver 版本。
function giteeProviderClass() {
  if (GiteeProvider) return GiteeProvider;
  const req = createRequire(require.resolve('electron-updater'));
  const { Provider, parseUpdateInfo } = req('./providers/Provider');
  const semver = req('semver');
  GiteeProvider = class extends Provider {
    constructor(options, updater, runtimeOptions) {
      super({ ...runtimeOptions, isUseMultipleRangeRequest: false });
      this.updater = updater;
    }
    async getLatestVersion() {
      const releases = [];
      for (let page = 1; ; page++) {
        const raw = await this.httpRequest(new URL(`${GITEE_API}?per_page=100&page=${page}`), { Accept: 'application/json' });
        const items = JSON.parse(raw);
        if (!Array.isArray(items)) throw Error('码云版本列表格式错误');
        releases.push(...items);
        if (items.length < 100) break;
        if (page === 20) throw Error('码云版本列表超过检查上限，请整理历史发行版');
      }
      const release = releases.filter(r => r && !r.draft && !r.prerelease && semver.valid(r.tag_name)
        && !semver.prerelease(r.tag_name)).sort((a, b) => semver.rcompare(a.tag_name, b.tag_name))[0];
      if (!release) throw Error('码云尚未发布正式版本；推送源码不会自动生成更新包');
      const version = semver.valid(release.tag_name);
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const asset = name => {
        const matches = assets.filter(a => a && a.name === name);
        if (matches.length !== 1) throw Error(`码云发行版缺少或重复附件：${name}`);
        return httpsUrl(matches[0].browser_download_url);
      };
      const manifestUrl = asset('latest.yml');
      const info = parseUpdateInfo(await this.httpRequest(manifestUrl), 'latest.yml', manifestUrl);
      if (!info || semver.valid(info.version) !== version) throw Error('码云更新清单版本与发行标签不一致');
      const installer = `CET-WordKeeper-${version}-setup.exe`;
      const files = Array.isArray(info.files) ? info.files : [];
      const matches = files.filter(f => {
        if (typeof f?.url !== 'string') return false;
        try { return decodeURIComponent(new URL(f.url, 'https://metadata.invalid/').pathname.split('/').pop()) === installer; }
        catch { return false; }
      });
      const file = matches[0];
      if (matches.length !== 1 || typeof file.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)
        || !Number.isSafeInteger(file.size) || file.size <= 0) throw Error('码云更新清单缺少有效的安装包、大小或 SHA-512 校验值');
      return { version, releaseName: release.name || version, releaseNotes: release.body || '',
        files: [{ url: asset(installer).href, sha512: file.sha512, size: file.size }] };
    }
    resolveFiles(info) {
      return info.files.map(file => ({ url: httpsUrl(file.url), info: file }));
    }
  };
  return GiteeProvider;
}

function createUpdates({ updater, current, portable = false, packaged = true, notify = () => {} }) {
  let state = { phase: 'idle', source: 'github', latest: null, percent: 0, error: null, revision: 0 };
  let checking = null, downloading = null, downloadReady = false;
  const busy = () => checking || downloading || ['checking','downloading','downloaded'].includes(state.phase);
  const snapshot = () => ({ ...state, current: current(), portable, canDownload: downloadReady && !portable && ['available','error'].includes(state.phase) });
  const push = patch => { state = { ...state, ...patch, revision: state.revision + 1 }; notify(snapshot()); };
  const message = error => String(error?.message || error).slice(0, 250);
  updater.autoInstallOnAppQuit = false;
  updater.autoDownload = false;
  updater.logger = null;
  if (!packaged) updater.forceDevUpdateConfig = true;
  updater.on('checking-for-update', () => push({ phase: 'checking', error: null }));
  updater.on('update-available', info => {downloadReady=true;push({ phase: 'available', latest: info.version });});
  updater.on('update-not-available', info => push({ phase: 'not-available', latest: info.version }));
  updater.on('download-progress', progress => push({ phase: 'downloading',
    percent: Math.max(0, Math.min(100, Math.round(progress.percent || 0))),
    mbPerSecond: Math.round(((progress.bytesPerSecond || 0) / 1048576) * 10) / 10 }));
  updater.on('update-downloaded', info => push({ phase: 'downloaded', latest: info.version, percent: 100, error: null }));
  updater.on('error', error => push({ phase: 'error', error: message(error) }));

  function download() {
    if (portable || !downloadReady || checking || downloading || !['available','error'].includes(state.phase)) return Promise.resolve({ok:false,...snapshot(),error:'当前没有可下载的更新或已有更新正在处理'});
    push({phase:'downloading',trigger:'manual',error:null,percent:0});
    downloading=Promise.resolve().then(()=>updater.downloadUpdate()).then(()=>({ok:true,...snapshot()})).catch(error=>{push({phase:'error',error:message(error)});return {ok:false,...snapshot()};}).finally(()=>{downloading=null;});return downloading;
  }
  async function run(source,options) {
    downloadReady=false;
    push({ phase: 'checking', source, trigger:options.trigger, latest: null, percent: 0, mbPerSecond: 0, error: null });
    try {
      updater.setFeedURL(source === 'gitee' ? { provider: 'custom', updateProvider: giteeProviderClass() }
        : { provider: 'github', owner: 'moshajiang', repo: 'CET-WordKeeper' });
      // 同一 updater 实例只允许一条检查/下载链；下载拒绝必须被消费。
      updater.autoDownload = false;
      const result = await updater.checkForUpdates();
      if (!result) throw Error('当前环境未启用版本更新');
      if (!result.isUpdateAvailable && state.phase==='checking') push({phase:'not-available',latest:result.updateInfo?.version||current()});
      if (result.isUpdateAvailable && state.phase==='checking' && result.updateInfo?.version) {downloadReady=true;push({phase:'available',latest:result.updateInfo.version});}
      if (result.isUpdateAvailable && !portable && options.download) {
        push({ phase: 'downloading' });
        downloading = Promise.resolve().then(() => updater.downloadUpdate())
          .catch(error => push({ phase: 'error', error: message(error) })).finally(() => { downloading = null; });
      }
      return { ok: true, ...snapshot() };
    } catch (error) {
      push({ phase: 'error', error: message(error) });
      return { ok: false, ...snapshot() };
    }
  }
  return {
    snapshot,
    isBusy:()=>!!busy(),
    download,
    selectSource(source) {if(!Object.hasOwn(SOURCES,source)||busy())throw Error('当前无法切换更新来源');downloadReady=false;push({phase:'idle',source,latest:null,error:null,percent:0});},
    check(source = 'github', options = {download:true,trigger:'manual'}) {
      if(!options||typeof options.download!=='boolean'||!['manual','automatic'].includes(options.trigger))return Promise.resolve({ok:false,...snapshot(),error:'更新检查选项无效'});
      if (!Object.hasOwn(SOURCES, source)) return Promise.resolve({ ok: false, ...snapshot(), error: '未知更新来源' });
      if (checking || downloading || state.phase === 'downloading' || state.phase === 'downloaded') {
        if (checking && source === state.source) return checking;
        return Promise.resolve({ ok: false, ...snapshot(), error: '请等待当前更新完成或安装后重试' });
      }
      checking = run(source,options).finally(() => { checking = null; });
      return checking;
    },
    releasesUrl(source = state.source) {
      if (!Object.hasOwn(SOURCES, source)) throw Error('未知更新来源');
      return SOURCES[source].url;
    },
    install() {
      if (state.phase !== 'downloaded') return { ok: false, error: '更新尚未下载完成' };
      try { updater.quitAndInstall(false, true); return { ok: true }; }
      catch (error) { return { ok: false, error: message(error) }; }
    },
  };
}

module.exports = { SOURCES, createUpdates, giteeProviderClass };
