import { copyFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const outputDirectory = resolve(projectRoot, 'public')

if (!outputDirectory.startsWith(`${projectRoot}${sep}`)) {
  throw new Error('Refusing to write outside the project directory')
}

const deployFiles = [
  'index.html',
  'app.js',
  'styles.css',
  'sw.js',
  'manifest.webmanifest',
  'pwa-icon-192.png',
  'pwa-icon-512.png',
  'pwa-icon.svg',
  'sapuri-pharmacy-logo.png',
]

await rm(outputDirectory, { recursive: true, force: true })
await mkdir(outputDirectory, { recursive: true })
await Promise.all(deployFiles.map((name) => copyFile(join(projectRoot, name), join(outputDirectory, name))))

console.log(`Prepared ${deployFiles.length} public files for Vercel`)
