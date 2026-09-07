import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'esbuild'

export const ASSET_VERSION_TOKEN = '__PEPOS_ASSET_VERSION__'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const outputDirectory = resolve(projectRoot, 'public')

const staticDeployFiles = [
  'manifest.webmanifest',
  'pwa-icon-192.png',
  'pwa-icon-512.png',
  'pwa-icon.svg',
  'sapuri-pharmacy-logo.png',
]

function addVersionInput(hash, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content))
  hash.update(String(bytes.length))
  hash.update(':')
  hash.update(bytes)
}

function renderVersionedTemplate(template, assetVersion, name) {
  if (!template.includes(ASSET_VERSION_TOKEN)) {
    throw new Error(`${name} is missing ${ASSET_VERSION_TOKEN}`)
  }
  const rendered = template.split(ASSET_VERSION_TOKEN).join(assetVersion)
  if (rendered.includes(ASSET_VERSION_TOKEN)) throw new Error(`${name} still contains an unresolved asset version`)
  return rendered
}

export async function prepareTextAssets({ appSource, excelToolsSource = '', stylesSource, indexTemplate, workerTemplate, versionInputs = [] }) {
  const [appResult, excelToolsResult, stylesResult] = await Promise.all([
    transform(appSource, {
      loader: 'js',
      target: 'es2020',
      charset: 'utf8',
      legalComments: 'none',
      // Transforming a classic script without bundling or an output format
      // preserves top-level names while still shortening local identifiers.
      // The regression test guards the generated inline-HTML callback name.
      minify: true,
    }),
    transform(excelToolsSource, { loader: 'js', target: 'es2020', charset: 'utf8', legalComments: 'none', minify: true }),
    transform(stylesSource, {
      loader: 'css',
      target: 'chrome100',
      charset: 'utf8',
      legalComments: 'none',
      minify: true,
    }),
  ])

  const hash = createHash('sha256')
  ;[appResult.code, excelToolsResult.code, stylesResult.code, indexTemplate, workerTemplate, ...versionInputs]
    .forEach(input => addVersionInput(hash, input))
  const assetVersion = hash.digest('hex').slice(0, 16)

  return {
    appCode: appResult.code,
    excelToolsCode: excelToolsResult.code,
    stylesCode: stylesResult.code,
    indexHtml: renderVersionedTemplate(indexTemplate, assetVersion, 'index.html'),
    workerCode: renderVersionedTemplate(workerTemplate, assetVersion, 'sw.js'),
    assetVersion,
  }
}

export async function buildStatic() {
  if (!outputDirectory.startsWith(`${projectRoot}${sep}`)) {
    throw new Error('Refusing to write outside the project directory')
  }

  const [appSource, excelToolsSource, stylesSource, indexTemplate, workerTemplate, ...staticContents] = await Promise.all([
    readFile(join(projectRoot, 'app.js'), 'utf8'),
    readFile(join(projectRoot, 'excel-tools.js'), 'utf8'),
    readFile(join(projectRoot, 'styles.css'), 'utf8'),
    readFile(join(projectRoot, 'index.html'), 'utf8'),
    readFile(join(projectRoot, 'sw.js'), 'utf8'),
    ...staticDeployFiles.map(name => readFile(join(projectRoot, name))),
  ])
  const prepared = await prepareTextAssets({
    appSource,
    excelToolsSource,
    stylesSource,
    indexTemplate,
    workerTemplate,
    versionInputs: staticContents,
  })

  await rm(outputDirectory, { recursive: true, force: true })
  await mkdir(outputDirectory, { recursive: true })
  await Promise.all([
    writeFile(join(outputDirectory, 'app.js'), prepared.appCode),
    writeFile(join(outputDirectory, 'excel-tools.js'), prepared.excelToolsCode),
    writeFile(join(outputDirectory, 'styles.css'), prepared.stylesCode),
    writeFile(join(outputDirectory, 'index.html'), prepared.indexHtml),
    writeFile(join(outputDirectory, 'sw.js'), prepared.workerCode),
    ...staticDeployFiles.map(name => copyFile(join(projectRoot, name), join(outputDirectory, name))),
  ])

  const jsSaving = Math.round((1 - prepared.appCode.length / appSource.length) * 100)
  const cssSaving = Math.round((1 - prepared.stylesCode.length / stylesSource.length) * 100)
  console.log(`Prepared ${staticDeployFiles.length + 5} public files (asset ${prepared.assetVersion}; JS -${jsSaving}%; CSS -${cssSaving}%)`)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === resolve(fileURLToPath(import.meta.url))) await buildStatic()
