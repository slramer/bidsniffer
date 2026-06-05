const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../public');
const base = 'https://bidsniffer.com';

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function fileToUrl(file) {
  let rel = '/' + path.relative(root, file).replace(/\\/g, '/');
  if (rel.endsWith('/index.html')) rel = rel.replace(/index\.html$/, '');
  else if (rel.endsWith('.html')) rel = rel.replace(/\.html$/, '');
  return `${base}${rel}`;
}

const urls = walk(root)
  .filter(f => f.endsWith('.html'))
  .map(fileToUrl)
  .sort();

const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>`;

fs.writeFileSync(path.join(root, 'sitemap.xml'), xml);
fs.writeFileSync(path.join(root, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
console.log(`Generated ${urls.length} sitemap URLs`);
