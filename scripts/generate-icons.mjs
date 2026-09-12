/**
 * Renders every launcher/PWA icon from public/icons/icon.svg.
 *
 * Run with `npm run icons` after editing the SVG. The Android launcher icons
 * are written straight into the Capacitor project, so a rebuild picks them up.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'public', 'icons', 'icon.svg');

/** Maskable icons get cropped to a circle by Android, so the art needs padding. */
async function maskable(svg, size, padRatio = 0.16) {
  const inner = Math.round(size * (1 - padRatio * 2));
  const art = await sharp(svg).resize(inner, inner).png().toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 11, g: 20, b: 18, alpha: 1 },
    },
  })
    .composite([{ input: art, top: Math.round((size - inner) / 2), left: Math.round((size - inner) / 2) }])
    .png()
    .toBuffer();
}

const webTargets = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
  ['favicon-32.png', 32],
];

/** Android mipmap buckets: folder -> launcher icon edge in px. */
const androidTargets = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192],
];

async function main() {
  const svg = await readFile(source);
  const outDir = join(root, 'public', 'icons');
  await mkdir(outDir, { recursive: true });

  for (const [name, size] of webTargets) {
    await sharp(svg).resize(size, size).png().toFile(join(outDir, name));
    console.log(`icons/${name}  ${size}x${size}`);
  }

  await writeFile(join(outDir, 'icon-512-maskable.png'), await maskable(svg, 512));
  console.log('icons/icon-512-maskable.png  512x512');

  // Android launcher icons, if the Capacitor project has been generated.
  const resDir = join(root, 'android', 'app', 'src', 'main', 'res');
  try {
    for (const [folder, size] of androidTargets) {
      const dir = join(resDir, folder);
      await mkdir(dir, { recursive: true });
      await sharp(svg).resize(size, size).png().toFile(join(dir, 'ic_launcher.png'));
      await sharp(svg).resize(size, size).png().toFile(join(dir, 'ic_launcher_round.png'));
      await writeFile(join(dir, 'ic_launcher_foreground.png'), await maskable(svg, size * 2, 0.22));
    }
    // Splash logo: a centred mark on the felt ground drawn by drawable/splash.xml.
    const splashDir = join(resDir, 'drawable');
    await mkdir(splashDir, { recursive: true });
    await sharp(svg).resize(384, 384).png().toFile(join(splashDir, 'splash_logo.png'));

    console.log('android launcher icons + splash updated');
  } catch (e) {
    console.log(`skipped android icons (${e.code ?? e.message}) — run after "npx cap add android"`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
