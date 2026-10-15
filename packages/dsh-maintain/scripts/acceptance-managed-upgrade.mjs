import { mkdir, mkdtemp, rm, readFile, writeFile, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createLayout, readSelectedVersion } from '../src/managed-layout.mjs'
import { performManagedUpgrade, findNpmCli } from '../src/managed-upgrade.mjs'
import { runProcess } from '../src/managed-process.mjs'

// 隔离npm依赖安装、A/B链接切换与失败验证；CLI smoke不等于宿主ready验收。
const [oldVersion, nextVersion] = process.argv.slice(2)
if (!oldVersion || !nextVersion) throw new Error('参数为:node scripts/acceptance-managed-upgrade.mjs <oldVersion> <nextVersion>')
const target = '@deepseek-ai/dsh'
const assert = (condition, message) => { if (!condition) throw new Error('验收失败: ' + message) }

// 隔离npm安装和CLI冒烟；不验证宿主profile启动或插件健康。
const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex')
const prefix = await mkdtemp(join(tmpdir(), 'maintain-acceptance-'))
const allowedEnvironmentKeys = process.platform === 'win32'
  ? ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'SYSTEMDRIVE', 'COMSPEC', 'PATHEXT', 'USERDOMAIN', 'USERNAME', 'OS', 'PROCESSOR_ARCHITECTURE']
  : ['PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'USER', 'LOGNAME', 'SHELL', 'TERM']
const env = Object.fromEntries(allowedEnvironmentKeys.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]))
const home = join(prefix, 'candidate-root')
env.HOME = home
env.USERPROFILE = home
if (process.platform === 'win32') {
  env.APPDATA = join(home, 'AppData', 'Roaming')
  env.LOCALAPPDATA = join(home, 'AppData', 'Local')
  env.HOMEDRIVE = resolve(home).slice(0, 2)
  env.HOMEPATH = resolve(home).slice(2)
}
env.DSH_HOME = join(home, '.dsh')
env.npm_config_cache = join(home, 'npm-cache')
env.npm_config_userconfig = join(home, 'npmrc')
env.npm_config_global = 'false'
const npmCli = await findNpmCli()

const install = version => async ({ slot, env: candidateEnv }) => runProcess({
  executable: process.execPath,
  args: [npmCli, 'install', '--prefix', slot, target + '@' + version, '--no-audit', '--no-fund'],
  cwd: slot,
  env: candidateEnv,
  timeoutMs: 20 * 60 * 1000,
  onOutput: () => process.stdout.write('.'),
})
const validate = async ({ slot, candidatePackage, env: candidateEnv }) => {
  const tree = await runProcess({ executable: process.execPath, args: [npmCli, 'ls', '--omit=dev', '--prefix', slot], cwd: slot, env: candidateEnv, timeoutMs: 60 * 1000 })
  if (!tree.ok) return tree
  const cli = join(candidatePackage, JSON.parse(await readFile(join(candidatePackage, 'package.json'), 'utf8')).bin.dsh)
  const bootEnv = { ...candidateEnv, DSH_HOME: join(slot, 'probe-home', '.dsh'), HOME: join(slot, 'probe-home'), USERPROFILE: join(slot, 'probe-home'), PORT: '0' }
  await mkdir(join(slot, 'probe-home'), { recursive: true })
  const boot = await runProcess({ executable: process.execPath, args: [cli, '--version'], cwd: candidatePackage, env: bootEnv, timeoutMs: 60 * 1000 })
  return boot.ok ? { ok: true } : { ...boot, stderrTail: boot.stderrTail || boot.stdoutTail || '隔离候选CLI版本探针失败' }
}

try {
  await mkdir(home, { recursive: true })
  const bootstrap = await runProcess({
    executable: process.execPath,
    args: [npmCli, 'install', '--prefix', prefix, target + '@' + oldVersion, '--no-audit', '--no-fund'],
    cwd: prefix, env, timeoutMs: 20 * 60 * 1000, onOutput: () => process.stdout.write('.'),
  })
  assert(bootstrap.ok, bootstrap.stderrTail || '原包安装失败')
  const originalPackage = join(prefix, 'node_modules', '@deepseek-ai', 'dsh')
  const manifest = JSON.parse(await readFile(join(originalPackage, 'package.json'), 'utf8'))
  const bin = join(originalPackage, manifest.bin.dsh)
  const before = await sha256(bin)
  const layout = await createLayout({ prefix, originalPackage, platform: process.platform })
  await mkdir(layout.root, { recursive: true })
  if (process.platform === 'win32') {
    for (const [name, content] of Object.entries({
      'dsh.cmd': '@"%dp0%node.exe" "%dp0%node_modules\\@deepseek-ai\\dsh\\' + manifest.bin.dsh.replaceAll('/', '\\') + '" %*\\r\\n',
      'dsh.ps1': '& "$basedir/node.exe" "$basedir/node_modules/@deepseek-ai/dsh/' + manifest.bin.dsh + '" $args\\n',
      dsh: '"$basedir/node" "$basedir/node_modules/@deepseek-ai/dsh/' + manifest.bin.dsh + '" "$@"\\n',
    })) await writeFile(join(prefix, name), content)
  } else {
    await mkdir(join(prefix, 'bin'), { recursive: true })
    await symlink(bin, join(prefix, 'bin', 'dsh'))
  }
  const candidateEnv = {
    ...env,
    HOME: join(layout.root, 'candidate-home'),
    USERPROFILE: join(layout.root, 'candidate-home'),
    DSH_HOME: join(layout.root, 'candidate-home', '.dsh'),
    npm_config_cache: join(layout.root, 'npm-cache'),
    npm_config_userconfig: join(layout.root, 'npmrc'),
  }
  const first = await performManagedUpgrade({ layout, runningPackage: originalPackage, targetVersion: nextVersion, install: install(nextVersion), validate, beforeSwitch: async () => {}, env: candidateEnv })
  assert(first.switched, '第一轮没有激活')
  assert(await readSelectedVersion(layout) === nextVersion, 'A/B链接版本错误')
  assert(await sha256(bin) === before, '原始CLI被修改')
  assert(await stat(join(layout.a, 'probe-home')).then(info => info.isDirectory(), () => false), 'CLI探针HOME未创建')
  const failedVersion = nextVersion === oldVersion ? nextVersion + '.1' : oldVersion
  await assertRejects(performManagedUpgrade({ layout, runningPackage: first.targetPackage, targetVersion: failedVersion, install: install(failedVersion), validate: async () => ({ ok: false, stderrTail: 'expected validation failure' }), beforeSwitch: async () => {}, env: candidateEnv }), 'expected validation failure')
  assert(await readSelectedVersion(layout) === nextVersion, '验证失败导致链接切换')
  const state = JSON.parse(await readFile(join(layout.root, 'state.json'), 'utf8'))
  assert(state.phase === 'failed', '失败状态未写入')
  assert(await stat(join(layout.root, 'upgrade.lock')).then(() => false, error => error.code === 'ENOENT'), '失败但安全的安装未释放锁')
  console.log('\n[acceptance] 通过 prefix=' + prefix + ' active=' + nextVersion)
} finally {
  await rm(prefix, { recursive: true, force: true })
}

async function assertRejects(promise, expected) {
  try { await promise } catch (error) { assert(String(error.message).includes(expected), '错误不匹配: ' + error.message); return }
  throw new Error('预期操作失败: ' + expected)
}
