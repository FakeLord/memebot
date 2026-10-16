// npm install sonrası Electron ikilisini indirir — web derlemesinde (Cloudflare Pages) gereksiz olduğu için atlanır.
// Cloudflare Pages CF_PAGES=1 ortam değişkenini kendisi tanımlar; elle atlamak için ELECTRON_SKIP_BINARY_DOWNLOAD=1.
if (process.env.CF_PAGES || process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
  console.log('Electron indirmesi atlandı (web derlemesi)')
} else {
  require('../node_modules/electron/install.js')
}
